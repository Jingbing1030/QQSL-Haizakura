// The media upload pipeline — the wiring that turns a message segment into the
// `MsgInfo` bytes a `send_msg` needs.
//
// Reference region: `../protocol/src/highway/pipeline.ts` (reference/index.mjs:34722+),
// `uploadImageMsgInfo` at `:110501`, `runNtv2Upload` at `:36928`.
//
// ---------------------------------------------------------------------------
// The four steps, and why they cannot be reordered
// ---------------------------------------------------------------------------
//   1. Hash the media (md5 + sha1, plus one sha1 per 1 MiB block).
//   2. Ask the server for a session (`NTV2UploadRichMediaReq`) — it replies with the
//      `uKey` and the upload servers.
//   3. POST each chunk over highway, using an extension payload built from step 2's
//      response.
//   4. Re-encode step 2's response as the `MsgInfo` that goes into `commonElem`.
//
// Step 4 is the one that surprises people: the `MsgInfo` in the outgoing message is
// **the upload response, re-encoded** — not a message the client composes. That is why
// `finalizeMediaMsgInfo` takes the upload result as an argument.
//
// Step 3 needs step 2's `uKey`; step 4 needs step 3 to have succeeded (the server
// marks the file as stored). So the sequence is strictly linear, and there is no
// batching opportunity even when several segments are in one message.
//
// ---------------------------------------------------------------------------
// Fast upload
// ---------------------------------------------------------------------------
// If the server already has the bytes (same md5, same account), it answers step 2
// with an EMPTY `uKey`. That is not an error: it means "skip step 3". The reference
// logs it and moves on. Treating it as a failure makes re-sending the same image
// fail, which is a common enough action to matter.
//
// ---------------------------------------------------------------------------
// Why this file exists rather than being inlined in `element-builder.ts`
// ---------------------------------------------------------------------------
// `element-builder` is pure: segments in, protobuf out, no I/O. Keeping the network
// path separate means the element encodings stay testable without a server, which is
// why there are 1,700+ tests over that file. This module is the impure half.

import { createHash } from "node:crypto";

import type { Bridge } from "../bridge/bridge.js";
import type {
  ImageSegment,
  MediaUploadResult,
  MediaUploader,
  RecordSegment,
  VideoSegment,
} from "../element-builder.js";
import { blockHashes, buildHighwayExtend } from "./ext.js";
import {
  NTV2_AGENT_TYPE,
  NTV2_REQUEST_TYPE,
  NTV2_SUB_FILE_TYPE_PRIMARY,
  NTV2_SUB_FILE_TYPE_THUMBNAIL,
  NTV2_UPLOAD_SUB_COMMAND,
  Ntv2BusinessType,
  Ntv2ExtBizInfoField,
  Ntv2MediaType,
  Ntv2PicFormat,
  Ntv2SceneType,
  PicExtBizInfoField,
  PicExtDataField,
  PttExtBizInfoField,
  VideoExtBizInfoField,
  encodeExtBizInfo,
  encodeNotOnlineImagePbReserve,
  encodeNtv2UploadEnvelope,
  type Ntv2ExtBizInfo,
  type Ntv2FileInfo,
  type Ntv2UploadInfo,
  type PicExtBizInfo,
  type PttExtBizInfo,
  type VideoExtBizInfo,
} from "../oidb/services/ntv2-upload.js";
import { HighwaySessionCache, bridgeSessionTransport } from "./session.js";
import { BufferChunkSource, uploadHighway } from "./upload.js";
import { ProtoReader, ProtoWriter, tagOf, WireType } from "../oidb/wire.js";

/**
 * OIDB command ids — the `command` field of the request envelope.
 *
 * These are NOT the `cmdId` that goes into the highway chunk head; see
 * `HIGHWAY_CMD_IDS` below. Confusing the two produces an upload the server accepts and
 * then never acknowledges, because the chunk head routes on its own id.
 */
export const NTV2_UPLOAD_COMMANDS = {
  groupImage: 4548,
  privateImage: 4549,
  groupVideo: 4586,
  privateVideo: 4585,
  groupVoice: 4718,
  privateVoice: 4717,
} as const;

/**
 * Highway `cmdId` — field 8 of `ReqDataHighwayHead`.
 *
 * Reference: `PRIVATE_IMAGE_CMD_ID=1003`, `GROUP_IMAGE_CMD_ID=1004`, `PRIVATE_VIDEO_CMD_ID=1001`,
 * `GROUP_VIDEO_CMD_ID=1005` (index.mjs:34122, 37481),
 * `PRIVATE_PTT_CMD_ID=1007`, `GROUP_PTT_CMD_ID=1008` (index.mjs:110778).
 * These are a different numbering space from the OIDB commands above, and using the
 * OIDB value here makes every chunk unroutable.
 */
export const HIGHWAY_CMD_IDS = {
  privateImage: 1003,
  groupImage: 1004,
  privatePtt: 1007,
  groupPtt: 1008,
  privateVideo: 1001,
  groupVideo: 1005,
  /** A video's thumbnail is a SECOND file and gets its own `cmdId` (`:37482`, `:37484`). */
  privateVideoThumb: 1002,
  groupVideoThumb: 1006,
} as const;

/**
 * The wire service names, one per command.
 *
 * The video pair is **`0x11ea` / `0x11e9`**, not `0x11da` / `0x11d9` (`reference/index.mjs:37657`).
 * `0x11da` is 4570 — a real command, so the request is routed somewhere and answered by
 * something that is not the upload service, which is worse than a plain rejection.
 */
export const NTV2_UPLOAD_SERVICE_CMDS = {
  groupImage: "OidbSvcTrpcTcp.0x11c4_100",
  privateImage: "OidbSvcTrpcTcp.0x11c5_100",
  groupVideo: "OidbSvcTrpcTcp.0x11ea_100",
  privateVideo: "OidbSvcTrpcTcp.0x11e9_100",
  groupVoice: "OidbSvcTrpcTcp.0x126e_100",
  privateVoice: "OidbSvcTrpcTcp.0x126d_100",
} as const;

/**
 * `NTV2CommonHead.requestId` per media type and scene.
 *
 * These are NOT interchangeable: 1 for an image (`:110538`), 3 for a video (`:37658`), and
 * **4 for a private voice while a group voice gets 1** (`:110898`). Reusing the image
 * value for a private voice produces a request the server rejects with an error that
 * names nothing.
 */
export const NTV2_REQUEST_IDS = {
  image: 1,
  video: 3,
  pttGroup: 1,
  pttPrivate: 4,
} as const;

/**
 * Default `NTV2FileType.voiceFormat`.
 *
 * The reference has **no code table** for this field. "amr=0, silk=1, mp3=2, flac=3,
 * wav=4" is a plausible guess and nothing in `reference/index.mjs` supports it, so it is
 * not asserted here. The only values the reference ever *writes* are 0 for image/video
 * (`:110543`, `:37670`) and 1 for every voice path (`:110790` `element.voiceFormat || 1`,
 * `:110849` `voiceFormat: 1` after silk conversion); incoming values are copied through
 * uninterpreted (`:135561`, `:39881`).
 *
 * So 1 is the default — it is what the client sends for the silk payload it produces — and
 * an explicit `segment.voiceFormat` always wins, which lets a caller round-trip a code it
 * read off an incoming message.
 */
export const NTV2_VOICE_FORMAT_DEFAULT = 1;

/** A zero-length bytes field: what the reference writes for every unused `extBizInfo` arm. */
const EMPTY_BYTES = new Uint8Array(0);

/**
 * `PttExtBizInfo.bytesReserve` — `08 00 38 00`, constant on every voice upload
 * (`:110924-110929`). It parses as a nested message (`field1: 0, field7: 0`), but the
 * reference pastes the literal rather than building it, so this does too.
 */
const PTT_BYTES_RESERVE = new Uint8Array([8, 0, 56, 0]);

/**
 * `PttExtBizInfo.bytesGeneralFlags` — **group voice only** (`:110931-110942`).
 *
 * `9a 01 07 aa 03 04 08 08 12 00`. A private voice omits the field entirely rather than
 * sending it empty, which is why the call site spreads it conditionally.
 */
const PTT_GROUP_BYTES_GENERAL_FLAGS = new Uint8Array([154, 1, 7, 170, 3, 4, 8, 8, 18, 0]);

/**
 * The `pic.textSummary` the reference sends on both voice and video (`:110921`, `:37701`).
 * It really is the literal "Nya~" — not a localized label, and not a placeholder.
 */
const MEDIA_PIC_SUMMARY = "Nya~";

/**
 * `VideoExtBizInfo.bytesPbReserve` — `80 01 00`, constant on every video upload in **both**
 * scenes (`:37703-37707`). Unlike the voice flags this one is not group-only.
 */
const VIDEO_BYTES_PB_RESERVE = new Uint8Array([128, 1, 0]);

/**
 * The fallback video thumbnail — the reference's own `FALLBACK_THUMB` (`:37494`), a
 * 720×1280 PNG of 5558 bytes.
 *
 * The reference only reaches for it when the native FFmpeg addon fails to pull a frame out
 * of the video (`:37553`). This port has no addon, so *every* video without a caller
 * supplied `thumbUrl` uses it. Reusing the reference's exact bytes matters: the server
 * stores the thumbnail in a slot keyed by its md5, so substituting "some other placeholder
 * PNG" would collide with, or attach to, the wrong resource.
 */
const FALLBACK_VIDEO_THUMB_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAtAAAAUACAIAAADhrPJqAAAACXBIWXMAAAABAAAAAQBPJcTWAAAQAElEQVR4nO3WQQkAMAzAwOqYf6FVEQblTkGemQcAEJvfAQDAfYYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGgi6AggAABVxJREFUAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACBnOACAnOEAAHKGAwDIGQ4AIGc4AICc4QAAcoYDAMgZDgAgZzgAgJzhAAByhgMAyBkOACC3fMQgSD2JVRsAAAAASUVORK5CYII=";

let cachedFallbackVideoThumb: Uint8Array | null = null;

/** Decoded once, on demand — 7 KiB of base64 is not worth decoding on every send. */
function fallbackVideoThumb(): Uint8Array {
  cachedFallbackVideoThumb ??= new Uint8Array(Buffer.from(FALLBACK_VIDEO_THUMB_BASE64, "base64"));
  return cachedFallbackVideoThumb;
}


/** `commonElem.businessType` per media type and scene. */
export const MEDIA_BUSINESS_TYPE = {
  imageGroup: 20,
  imagePrivate: 10,
  videoGroup: 21,
  videoPrivate: 11,
  voiceGroup: 22,
  voicePrivate: 12,
} as const;

/** What an `ImageSegment` carries once resolved. */
interface LoadedImage {
  bytes: Uint8Array;
  md5Hex: string;
  sha1Hex: string;
  fileSize: number;
  fileName: string;
  width: number;
  height: number;
  picFormat: number;
  subType: number;
  summary: string;
}

/**
 * Map a magic-number prefix to the server's `picFormat` code.
 *
 * The codes are **not** sequential — 1000, 1001, 1002, 1005 — so deriving them
 * arithmetically from an enum order is wrong. The reference's `detectImageFormat`
 * uses this table.
 */
function detectPicFormat(bytes: Uint8Array): number {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return Ntv2PicFormat.jpg;
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return Ntv2PicFormat.png;
  }
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.subarray(0, 6));
    if (head === "GIF87a" || head === "GIF89a") return Ntv2PicFormat.gifOrWebp;
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return Ntv2PicFormat.gifOrWebp;
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return Ntv2PicFormat.bmp;
  }
  // The reference defaults to jpg for anything unrecognised. Returning 0 would omit the
  // field and the server would reject the upload as "unknown image type".
  return Ntv2PicFormat.jpg;
}

/**
 * Extract the bytes from a segment's `file` field.
 *
 * Accepts `base64://`, `hex://`, and a plain path. The reference also accepts a
 * `file://` URL; none of these are validated here beyond what is needed to produce
 * bytes, because a bad source should surface as a readable error from the caller.
 */
async function resolveSegmentBytes(segment: ImageSegment | RecordSegment | VideoSegment): Promise<Uint8Array> {
  // Every segment type names its source slightly differently: `imageUrl` for an image,
  // `url` for record and video. All three accept the same forms (`base64://`, `hex://`,
  // or a filesystem path).
  const file = "imageUrl" in segment ? segment.imageUrl : segment.url;
  if (file === undefined || file === "") {
    throw new Error("media segment has no file source");
  }
  if (file.startsWith("base64://")) {
    return new Uint8Array(Buffer.from(file.slice("base64://".length), "base64"));
  }
  if (file.startsWith("hex://")) {
    return new Uint8Array(Buffer.from(file.slice("hex://".length), "hex"));
  }
  // A filesystem path. `node:fs` is imported lazily so this module stays importable in
  // environments without filesystem access (tests, the WebUI bundle).
  const { readFile } = await import("node:fs/promises");
  return new Uint8Array(await readFile(file.replace(/^file:\/\//, "")));
}

/** Project a resolved image into the `fileInfo` the upload request wants. */
function imageFileInfo(image: LoadedImage): Ntv2FileInfo {
  return {
    fileSize: image.fileSize,
    // Hex STRINGS, not digests — see ntv2-upload.ts.
    fileHash: image.md5Hex,
    fileSha1: image.sha1Hex,
    fileName: image.fileName,
    type: { type: Ntv2MediaType.image, picFormat: image.picFormat },
    width: image.width,
    height: image.height,
    time: 0,
    original: 1,
  };
}

/** The three `extBizInfo` arms, with the unused ones present but empty. */
function imageExtBizInfo(image: LoadedImage, isGroup: boolean): Ntv2ExtBizInfo {
  // The two arms are mutually exclusive: `extData` for group, `bytesPbReserveC2c` for
  // private. Sending both is not what the client does.
  const pic = isGroup
    ? { bizType: image.subType, textSummary: image.summary, extData: { subType: image.subType, textSummary: image.summary } }
    : {
        bizType: image.subType,
        textSummary: image.summary,
        // The 18-byte sub-protobuf, golden-verified in ntv2-upload.test.ts.
        bytesPbReserveC2c: encodeNotOnlineImagePbReserve(image.subType, image.summary),
      };
  return {
    pic,
    video: { bytesPbReserve: new Uint8Array(0) },
    ptt: {
      bytesReserve: new Uint8Array(0),
      bytesPbReserve: new Uint8Array(0),
      bytesGeneralFlags: new Uint8Array(0),
    },
  };
}

/** Read the image dimensions from the header, without a full decode. */
function imageDimensions(bytes: Uint8Array, picFormat: number): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (picFormat === Ntv2PicFormat.png && bytes.length >= 24) {
      return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
    }
    if (picFormat === Ntv2PicFormat.gifOrWebp && bytes.length >= 10) {
      // GIF: little-endian at offset 6.
      return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
    }
    if (picFormat === Ntv2PicFormat.jpg) {
      // Walk the JPEG segment chain looking for a start-of-frame marker.
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1]!;
        const length = view.getUint16(offset + 2, false);
        // SOF0..SOF15, excluding the DHT/JPG/DAC markers.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
        }
        offset += 2 + length;
      }
    }
  } catch {
    // A truncated header is not worth failing the upload over: the server does not
    // validate dimensions, and 0/0 is what the reference sends for an unparseable image.
  }
  return { width: 0, height: 0 };
}

/** Options the pipeline needs beyond the segment. */
export interface MediaUploadContext {
  bridge: Bridge;
  isGroup: boolean;
  /** Group id for a group send; target uid for a private one. */
  targetIdOrUid: string;
  /** Source group for a temporary session. Selects the temp-group scene. */
  tempGroupId?: number;
  /** Shared across sends so a burst of images does not re-bootstrap every time. */
  sessionCache?: HighwaySessionCache;
  /**
   * A pre-computed `PttWaveform` blob for a voice send.
   *
   * Optional because the reference derives it from the silk payload with the native FFmpeg
   * addon (`encodePttWaveform`, `:110749`), which this port does not have. When absent the
   * `waveform` field is omitted entirely — exactly what the reference does when the addon
   * cannot compute one. The field is not required for the voice to play; it only drives the
   * progress bar the client draws.
   */
  pttWaveform?: Uint8Array;
  /**
   * The highway PUT, injectable **for tests only**.
   *
   * A video's two PUTs are the one part of this module a fake bridge cannot observe: they
   * open sockets rather than going through `sendRawPacket`. Without this seam the claim
   * "the thumbnail uses `subFileInfos[0].uKey` and `cmdId` 1006/1002" would be untested —
   * and it is exactly the claim that is easy to get wrong. Defaults to the real
   * `uploadHighway`.
   */
  putChunks?: typeof uploadHighway;
}

/**
 * Upload one image and return the `MsgInfo` for `commonElem`.
 *
 * Honours fast-upload: when the server answers step 2 with an empty `uKey` it already
 * has the bytes, so step 3 is skipped. That is a success, not a failure — treating it
 * as one breaks re-sending the same image.
 */
export async function uploadImage(
  context: MediaUploadContext,
  segment: ImageSegment,
): Promise<MediaUploadResult> {
  // `noByteFallback` is the reference's fingerprint-only path (`loadImage`,
  // reference/index.mjs:110462): the caller already knows md5/sha1/geometry and the
  // server already has the bytes, so nothing is read from disk or the network.
  //
  // This port needs it for merged forwards. A forward node decoded off the wire has NO
  // readable byte source — `imageUrl` is a CDN URL for display, and treating it as an
  // upload source would make every re-forwarded image download and re-POST bytes the
  // server already has. Without this branch, `resolveSegmentBytes` throws "media segment
  // has no file source" and a forward containing any image can never be re-sent.
  if (segment.noByteFallback === true) {
    if (!segment.md5Hex || !segment.sha1Hex) {
      throw new Error("image fast-upload requires md5Hex + sha1Hex");
    }
    const fingerprintImage: LoadedImage = {
      bytes: new Uint8Array(0),
      md5Hex: segment.md5Hex,
      sha1Hex: segment.sha1Hex,
      // The SERVER's copy decides the real size; 0 is what the reference sends
      // (`fileSize: element.fileSize ?? 0`) and the fingerprint path never reads it back.
      fileSize: segment.fileSize ?? 0,
      fileName:
        segment.fileName ??
        `${segment.md5Hex}.${(segment.picFormat ?? Ntv2PicFormat.jpg) === Ntv2PicFormat.png ? "png" : "jpg"}`,
      width: segment.width ?? 0,
      height: segment.height ?? 0,
      picFormat: segment.picFormat ?? Ntv2PicFormat.jpg,
      subType: segment.subType ?? 0,
      summary: segment.summary ?? (segment.subType === 1 ? "[动画表情]" : "[图片]"),
    };
    return await runImageUpload(context, fingerprintImage);
  }

  const bytes = await resolveSegmentBytes(segment);
  const picFormat = detectPicFormat(bytes);
  const { width, height } = imageDimensions(bytes, picFormat);
  const image: LoadedImage = {
    bytes,
    md5Hex: createHash("md5").update(bytes).digest("hex"),
    sha1Hex: createHash("sha1").update(bytes).digest("hex"),
    fileSize: bytes.length,
    fileName:
      ("fileName" in segment ? segment.fileName : undefined) ??
      `${createHash("md5").update(bytes).digest("hex")}.${picFormat === Ntv2PicFormat.png ? "png" : "jpg"}`,
    width,
    height,
    picFormat,
    subType: segment.subType ?? 0,
    summary: segment.summary ?? "[图片]",
  };
  return await runImageUpload(context, image);
}

/**
 * The two-request image upload, split out so the fingerprint path and the byte path
 * share ONE implementation.
 *
 * Keeping a second copy for `noByteFallback` would let the two drift on
 * `extBizInfo`/`compatQmsgSceneType`, which is exactly the sort of divergence that looks
 * fine in a unit test and renders as a broken image on a phone.
 */
async function runImageUpload(
  context: MediaUploadContext,
  image: LoadedImage,
): Promise<MediaUploadResult> {
  const bytes = image.bytes;

  const sceneType = context.isGroup ? Ntv2SceneType.group : Ntv2SceneType.c2c;
  const commandId = context.isGroup
    ? NTV2_UPLOAD_COMMANDS.groupImage
    : NTV2_UPLOAD_COMMANDS.privateImage;

  const uploadInfo: Ntv2UploadInfo[] = [
    { fileInfo: imageFileInfo(image), subFileType: NTV2_SUB_FILE_TYPE_PRIMARY },
  ];

  // Step 2: request the upload session. The response carries `uKey` and the servers.
  const request = encodeNtv2UploadEnvelope({
    command: commandId,
    subCommand: NTV2_UPLOAD_SUB_COMMAND,
    body: {
      reqHead: {
        common: { requestId: NTV2_REQUEST_IDS.image, command: NTV2_UPLOAD_SUB_COMMAND },
        scene: {
          requestType: NTV2_REQUEST_TYPE,
          businessType: Ntv2BusinessType.image,
          sceneType,
          ...(context.isGroup
            ? { group: { groupUin: Number(context.targetIdOrUid) } }
            : { c2c: { accountType: 2, targetUid: context.targetIdOrUid } }),
        },
        client: { agentType: NTV2_AGENT_TYPE },
      },
      upload: {
        uploadInfo,
        tryFastUploadCompleted: true,
        compatQmsgSceneType: context.isGroup ? 2 : 1,
        extBizInfo: imageExtBizInfo(image, context.isGroup),
      },
    },
    reserved: 1,
  });

  const result = await context.bridge.sendRawPacket(
    context.isGroup
      ? NTV2_UPLOAD_SERVICE_CMDS.groupImage
      : NTV2_UPLOAD_SERVICE_CMDS.privateImage,
    request,
  );
  if (!result.success || !result.gotResponse || !result.responseData) {
    throw new Error(result.errorMessage || "NTV2 upload request failed");
  }

  const response = decodeUploadResponse(result.responseData);
  const uploadResp = response.upload;
  if (!uploadResp) throw new Error("upload response missing msgInfo");

  // Step 3: PUT the bytes, unless the server already has them. An empty `uKey` IS the
  // fast-upload signal.
  if (uploadResp.uKey !== undefined && uploadResp.uKey !== "") {
    if (bytes.length === 0) {
      // The server asked for bytes on a fingerprint-only upload. There are none to send,
      // and the reference raises the same per-upload message (`:110522`).
      throw new Error("image fast-upload not available (server requires bytes)");
    }
    // The bootstrap is deliberately deferred to here. Requesting it before the response
    // makes a fast upload — the server already having the bytes — pay two SSO
    // round-trips for a transfer that never happens.
    const sessionCache =
      context.sessionCache ?? new HighwaySessionCache(bridgeSessionTransport(context.bridge));
    const session = await sessionCache.get();
    const hashes = await blockHashes(bytes.length, (offset, length) =>
      Promise.resolve(bytes.subarray(offset, offset + length)),
    );
    const extend = buildHighwayExtend(
      uploadResp.uKey,
      { msgInfoBody: uploadResp.msgInfo?.msgInfoBody ?? [] },
      uploadResp.ipv4s ?? [],
      hashes,
    );
    await uploadHighway(new BufferChunkSource(bytes), {
      uin: String(context.bridge.identity?.uin ?? ""),
      // The HIGHWAY cmdId, not the OIDB command — see HIGHWAY_CMD_IDS.
      commandId: context.isGroup ? HIGHWAY_CMD_IDS.groupImage : HIGHWAY_CMD_IDS.privateImage,
      session,
      fileMd5: new Uint8Array(Buffer.from(image.md5Hex, "hex")),
      extend,
    });
  }

  // Step 4: re-encode the response as the outgoing `MsgInfo`.
  return {
    msgInfo: encodeMsgInfo(uploadResp),
    ...(uploadResp.compatQMsg !== undefined ? { compatQMsg: uploadResp.compatQMsg } : {}),
  };
}

/**
 * Decode an `NTV2UploadRichMediaResp`.
 *
 * Only the fields the pipeline reads are decoded; the rest are skipped, because the
 * server adds fields over time and a strict decoder turns an addition into a broken
 * send.
 */
export interface UploadResponse {
  upload?: {
    uKey?: string;
    ipv4s?: { outIp?: number; outPort?: number }[];
    msgInfo?: {
      msgInfoBody?: {
        index?: { info?: Ntv2FileInfo; fileUuid?: string; storeId?: number; uploadTime?: number; ttl?: number; subType?: number };
        picture?: { urlPath?: string; ext?: { originalParameter?: string; bigParameter?: string; thumbParameter?: string }; domain?: string };
        fileExist?: boolean;
        hashSum?: { bytesPbReserveC2c?: { friendUid?: string }; troopSource?: { groupUin?: number } };
      }[];
      extBizInfo?: Ntv2ExtBizInfo;
    };
    compatQMsg?: Uint8Array;
    /**
     * One entry per SUB-file the server wants uploaded separately — a video's thumbnail
     * lands in index 0 (`NTV2SubFileInfoResp`, `:29834`; `:37008` is the read).
     *
     * `subType` is repeated out of order in that message (1 `subType`, 2 `uKey`,
     * 3 `uKeyTtl`, 4 `ipv4s`), so the decode cannot assume field order.
     */
    subFileInfos?: {
      subType?: number;
      uKey?: string;
      ipv4s?: { outIp?: number; outPort?: number }[];
    }[];
  };
}

/**
 * Decode an `NTV2UploadRichMediaResp`.
 *
 * Field numbers are from `docs/ntv2-upload-codec.md` §4.12:
 *   resp: 1 respHead, 2 upload
 *   upload body: 1 uKey, 2 uKeyTtl, 3 ipv4s, 5 msgSeq, 6 msgInfo, 8 compatQMsg,
 *                10 subFileInfos
 *   ipv4: 1 outIp, 2 outPort
 *   msgInfo: 1 msgInfoBody (repeated), 2 extBizInfo
 *
 * Unknown fields are skipped rather than rejected: the server adds fields over time and a
 * strict decoder would turn an addition into a broken send.
 */
export function decodeUploadResponse(bytes: Uint8Array): UploadResponse {
  // Two shapes arrive here and they are told apart by their first tag, not by a flag:
  //
  //   * an OIDB envelope — `{1 command, 2 serviceType, 3 result, 4 body}`. This is what the
  //     payload returns for a forwarded `OidbSvcTrpcTcp.*` command, and it is the shape seen on
  //     the live server (2157 bytes: `08c423 1064 1800 22c40b <1476-byte body>`).
  //   * the bare `NTV2UploadRichMediaResp` — `{1 respHead, 2 upload}`, which is what a caller
  //     that already unwrapped the envelope hands over, and what the golden tests use.
  //
  // Distinguishing them by the first tag is exact here: an OIDB envelope always starts with
  // field 1 as a varint (the command id, 4548), while the bare response starts with field 1 as
  // length-delimited (the head message). No correct encoding of either can look like the other.
  //
  // Getting this wrong is silent: reading the envelope as the bare response finds field 1 as a
  // varint, skips it, finds field 2 as a varint (service type 100), skips it, and returns an
  // empty `upload` — which surfaces as "upload response missing msgInfo" even though the server
  // answered correctly.
  const inner = unwrapOidbEnvelope(bytes);
  const reader = new ProtoReader(inner);
  const response: UploadResponse = {};
  while (reader.next()) {
    if (reader.tag === tagOf(2, WireType.lengthDelimited)) {
      response.upload = decodeUploadBody(reader.bytes());
    } else {
      reader.skip();
    }
  }
  return response;
}

/** OIDB envelope field 4 carries the service response body. */
const OIDB_FIELD_BODY = 4;

/**
 * Strip an OIDB envelope, returning the inner body; return `bytes` unchanged when there is none.
 *
 * Returns the original array (not a copy) in the no-envelope case, so the golden tests keep
 * comparing exactly the bytes they passed in.
 */
export function unwrapOidbEnvelope(bytes: Uint8Array): Uint8Array {
  const reader = new ProtoReader(bytes);
  let body: Uint8Array | undefined;
  let sawVarintField1 = false;
  while (reader.next()) {
    if (reader.tag === tagOf(1, WireType.varint)) {
      sawVarintField1 = true;
      reader.skip();
      continue;
    }
    if (reader.tag === tagOf(OIDB_FIELD_BODY, WireType.lengthDelimited)) {
      body = reader.bytes();
      continue;
    }
    reader.skip();
  }
  // Only treat it as an envelope when the shape is unambiguous: field 1 varint AND a field 4
  // body. A bare NTV2 response has neither, so this cannot strip a valid bare response.
  return sawVarintField1 && body !== undefined ? body : bytes;
}

function decodeUploadBody(bytes: Uint8Array): NonNullable<UploadResponse["upload"]> {
  const reader = new ProtoReader(bytes);
  const body: NonNullable<UploadResponse["upload"]> = {};
  const ipv4s: { outIp?: number; outPort?: number }[] = [];
  const subFileInfos: NonNullable<NonNullable<UploadResponse["upload"]>["subFileInfos"]> = [];
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        body.uKey = reader.string();
        break;
      case tagOf(3, WireType.lengthDelimited):
        ipv4s.push(decodeIPv4(reader.bytes()));
        break;
      case tagOf(6, WireType.lengthDelimited):
        body.msgInfo = decodeMsgInfo(reader.bytes());
        break;
      case tagOf(8, WireType.lengthDelimited):
        body.compatQMsg = reader.bytes();
        break;
      case tagOf(10, WireType.lengthDelimited):
        // A video's thumbnail is described HERE, not in the main body: the request sends
        // it as a second `uploadInfo` entry and the server answers with a matching
        // `subFileInfos` entry that carries its own `uKey` and servers.
        subFileInfos.push(decodeSubFileInfo(reader.bytes()));
        break;
      default:
        // Includes `uKeyTtl` (2) and `msgSeq` (5), which nothing downstream reads.
        reader.skip();
        break;
    }
  }
  if (ipv4s.length > 0) body.ipv4s = ipv4s;
  if (subFileInfos.length > 0) body.subFileInfos = subFileInfos;
  return body;
}

/**
 * Decode one `NTV2SubFileInfoResp` (`:29834`).
 *
 * Field order is unusual and load-bearing: `subType` is **1**, `uKey` 2, `uKeyTtl` 3,
 * `ipv4s` 4. Reading `uKey` off field 1 yields the sub-file's type as a string, which
 * encodes to a uKey the server rejects at the chunk stage rather than at the request.
 */
function decodeSubFileInfo(bytes: Uint8Array): NonNullable<
  NonNullable<UploadResponse["upload"]>["subFileInfos"]
>[number] {
  const reader = new ProtoReader(bytes);
  const info: NonNullable<NonNullable<UploadResponse["upload"]>["subFileInfos"]>[number] = {};
  const ipv4s: { outIp?: number; outPort?: number }[] = [];
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.varint):
        info.subType = Number(reader.uint64());
        break;
      case tagOf(2, WireType.lengthDelimited):
        info.uKey = reader.string();
        break;
      case tagOf(4, WireType.lengthDelimited):
        ipv4s.push(decodeIPv4(reader.bytes()));
        break;
      default:
        reader.skip();
        break;
    }
  }
  if (ipv4s.length > 0) info.ipv4s = ipv4s;
  return info;
}

function decodeIPv4(bytes: Uint8Array): { outIp?: number; outPort?: number } {
  const reader = new ProtoReader(bytes);
  const ipv4: { outIp?: number; outPort?: number } = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.varint):
        ipv4.outIp = Number(reader.uint64());
        break;
      case tagOf(2, WireType.varint):
        ipv4.outPort = Number(reader.uint64());
        break;
      default:
        reader.skip();
        break;
    }
  }
  return ipv4;
}

function decodeMsgInfo(bytes: Uint8Array): NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]> {
  const reader = new ProtoReader(bytes);
  const msgInfo: NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]> = {};
  const bodies: NonNullable<typeof msgInfo.msgInfoBody> = [];
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        bodies.push(decodeMsgInfoBody(reader.bytes()));
        break;
      case tagOf(2, WireType.lengthDelimited):
        // The server echoes back the `extBizInfo` it stored, and the reference re-encodes
        // whatever came back into the outgoing `MsgInfo` (`finalizeMediaMsgInfo`, `:37064`).
        msgInfo.extBizInfo = decodeExtBizInfo(reader.bytes());
        break;
      default:
        reader.skip();
        break;
    }
  }
  if (bodies.length > 0) msgInfo.msgInfoBody = bodies;
  return msgInfo;
}

/**
 * Decode the `extBizInfo` the server echoes (`NTV2ExtBizInfo`, field table in
 * `ntv2-upload.ts`).
 *
 * This is decoded rather than copied because the pipeline re-encodes it: a raw copy would
 * carry the response's field order, and the reference's own encoder is what the client
 * parses. The `ptt` arm is the one that matters — a voice's waveform arrives back through
 * it and would otherwise be dropped.
 */
function decodeExtBizInfo(bytes: Uint8Array): Ntv2ExtBizInfo {
  const reader = new ProtoReader(bytes);
  const info: Ntv2ExtBizInfo = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(Ntv2ExtBizInfoField.pic, WireType.lengthDelimited):
        info.pic = decodePicExtBizInfo(reader.bytes());
        break;
      case tagOf(Ntv2ExtBizInfoField.video, WireType.lengthDelimited):
        info.video = decodeVideoExtBizInfo(reader.bytes());
        break;
      case tagOf(Ntv2ExtBizInfoField.ptt, WireType.lengthDelimited):
        info.ptt = decodePttExtBizInfo(reader.bytes());
        break;
      case tagOf(Ntv2ExtBizInfoField.busiType, WireType.varint):
        info.busiType = reader.uint32();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

function decodePicExtBizInfo(bytes: Uint8Array): PicExtBizInfo {
  const reader = new ProtoReader(bytes);
  const pic: PicExtBizInfo = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(PicExtBizInfoField.bizType, WireType.varint):
        pic.bizType = reader.uint32();
        break;
      case tagOf(PicExtBizInfoField.textSummary, WireType.lengthDelimited):
        pic.textSummary = reader.string();
        break;
      case tagOf(PicExtBizInfoField.bytesPbReserveC2c, WireType.lengthDelimited):
        pic.bytesPbReserveC2c = reader.bytes();
        break;
      case tagOf(PicExtBizInfoField.extData, WireType.lengthDelimited): {
        const extReader = new ProtoReader(reader.bytes());
        const extData: NonNullable<PicExtBizInfo["extData"]> = {};
        while (extReader.next()) {
          if (extReader.tag === tagOf(PicExtDataField.subType, WireType.varint)) {
            extData.subType = extReader.uint32();
          } else if (extReader.tag === tagOf(PicExtDataField.textSummary, WireType.lengthDelimited)) {
            extData.textSummary = extReader.string();
          } else {
            extReader.skip();
          }
        }
        pic.extData = extData;
        break;
      }
      case tagOf(PicExtBizInfoField.fromScene, WireType.varint):
        pic.fromScene = reader.uint32();
        break;
      case tagOf(PicExtBizInfoField.toScene, WireType.varint):
        pic.toScene = reader.uint32();
        break;
      case tagOf(PicExtBizInfoField.oldFileId, WireType.varint):
        pic.oldFileId = reader.uint32();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return pic;
}

function decodeVideoExtBizInfo(bytes: Uint8Array): VideoExtBizInfo {
  const reader = new ProtoReader(bytes);
  const video: VideoExtBizInfo = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(VideoExtBizInfoField.fromScene, WireType.varint):
        video.fromScene = reader.uint32();
        break;
      case tagOf(VideoExtBizInfoField.toScene, WireType.varint):
        video.toScene = reader.uint32();
        break;
      case tagOf(VideoExtBizInfoField.bytesPbReserve, WireType.lengthDelimited):
        video.bytesPbReserve = reader.bytes();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return video;
}

/**
 * Decode the `ptt` arm.
 *
 * `srcUin` is uint64 and stays a bigint: narrowing it would survive every realistic uin
 * and then silently corrupt one above 2^53.
 */
function decodePttExtBizInfo(bytes: Uint8Array): PttExtBizInfo {
  const reader = new ProtoReader(bytes);
  const ptt: PttExtBizInfo = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(PttExtBizInfoField.srcUin, WireType.varint):
        ptt.srcUin = reader.uint64();
        break;
      case tagOf(PttExtBizInfoField.pttScene, WireType.varint):
        ptt.pttScene = reader.uint32();
        break;
      case tagOf(PttExtBizInfoField.pttType, WireType.varint):
        ptt.pttType = reader.uint32();
        break;
      case tagOf(PttExtBizInfoField.changeVoice, WireType.varint):
        ptt.changeVoice = reader.uint32();
        break;
      case tagOf(PttExtBizInfoField.waveform, WireType.lengthDelimited):
        ptt.waveform = reader.bytes();
        break;
      case tagOf(PttExtBizInfoField.autoConvertText, WireType.varint):
        ptt.autoConvertText = reader.uint32();
        break;
      case tagOf(PttExtBizInfoField.bytesReserve, WireType.lengthDelimited):
        ptt.bytesReserve = reader.bytes();
        break;
      case tagOf(PttExtBizInfoField.bytesPbReserve, WireType.lengthDelimited):
        ptt.bytesPbReserve = reader.bytes();
        break;
      case tagOf(PttExtBizInfoField.bytesGeneralFlags, WireType.lengthDelimited):
        ptt.bytesGeneralFlags = reader.bytes();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return ptt;
}

function decodeMsgInfoBody(
  bytes: Uint8Array,
): NonNullable<NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]>["msgInfoBody"]>[number] {
  const reader = new ProtoReader(bytes);
  const body: NonNullable<
    NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]>["msgInfoBody"]
  >[number] = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        body.index = decodeIndexNode(reader.bytes());
        break;
      case tagOf(2, WireType.lengthDelimited):
        body.picture = decodePictureInfo(reader.bytes());
        break;
      case tagOf(5, WireType.varint):
        body.fileExist = reader.bool();
        break;
      case tagOf(6, WireType.lengthDelimited):
        body.hashSum = decodeHashSum(reader.bytes());
        break;
      default:
        reader.skip();
        break;
    }
  }
  return body;
}

type IndexNodeShape = NonNullable<
  NonNullable<NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]>["msgInfoBody"]>
>[number]["index"];

function decodeIndexNode(bytes: Uint8Array): NonNullable<IndexNodeShape> {
  const reader = new ProtoReader(bytes);
  const node: NonNullable<IndexNodeShape> = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        node.info = decodeFileInfo(reader.bytes());
        break;
      case tagOf(2, WireType.lengthDelimited):
        node.fileUuid = reader.string();
        break;
      case tagOf(3, WireType.varint):
        node.storeId = Number(reader.uint64());
        break;
      case tagOf(4, WireType.varint):
        node.uploadTime = Number(reader.uint64());
        break;
      case tagOf(5, WireType.varint):
        node.ttl = Number(reader.uint64());
        break;
      case tagOf(6, WireType.varint):
        node.subType = Number(reader.uint64());
        break;
      default:
        reader.skip();
        break;
    }
  }
  return node;
}

function decodeFileInfo(bytes: Uint8Array): Ntv2FileInfo {
  const reader = new ProtoReader(bytes);
  const info: Ntv2FileInfo = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.varint):
        info.fileSize = Number(reader.uint64());
        break;
      case tagOf(2, WireType.lengthDelimited):
        info.fileHash = reader.string();
        break;
      case tagOf(3, WireType.lengthDelimited):
        info.fileSha1 = reader.string();
        break;
      case tagOf(4, WireType.lengthDelimited):
        info.fileName = reader.string();
        break;
      case tagOf(6, WireType.varint):
        info.width = Number(reader.uint64());
        break;
      case tagOf(7, WireType.varint):
        info.height = Number(reader.uint64());
        break;
      case tagOf(8, WireType.varint):
        info.time = Number(reader.uint64());
        break;
      case tagOf(9, WireType.varint):
        info.original = Number(reader.uint64());
        break;
      default:
        reader.skip();
        break;
    }
  }
  return info;
}

type PictureShape = NonNullable<
  NonNullable<NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]>["msgInfoBody"]>
>[number]["picture"];

function decodePictureInfo(bytes: Uint8Array): NonNullable<PictureShape> {
  const reader = new ProtoReader(bytes);
  const picture: NonNullable<PictureShape> = {};
  while (reader.next()) {
    switch (reader.tag) {
      case tagOf(1, WireType.lengthDelimited):
        picture.urlPath = reader.string();
        break;
      case tagOf(2, WireType.lengthDelimited): {
        const extReader = new ProtoReader(reader.bytes());
        const ext: NonNullable<PictureShape>["ext"] = {};
        while (extReader.next()) {
          switch (extReader.tag) {
            case tagOf(1, WireType.lengthDelimited):
              ext.originalParameter = extReader.string();
              break;
            case tagOf(2, WireType.lengthDelimited):
              ext.bigParameter = extReader.string();
              break;
            case tagOf(3, WireType.lengthDelimited):
              ext.thumbParameter = extReader.string();
              break;
            default:
              extReader.skip();
              break;
          }
        }
        picture.ext = ext;
        break;
      }
      case tagOf(3, WireType.lengthDelimited):
        picture.domain = reader.string();
        break;
      default:
        reader.skip();
        break;
    }
  }
  return picture;
}

type HashSumShape = NonNullable<
  NonNullable<NonNullable<NonNullable<UploadResponse["upload"]>["msgInfo"]>["msgInfoBody"]>
>[number]["hashSum"];

function decodeHashSum(bytes: Uint8Array): NonNullable<HashSumShape> {
  const reader = new ProtoReader(bytes);
  const hashSum: NonNullable<HashSumShape> = {};
  while (reader.next()) {
    // Fields 201 and 202 — the hundred-based trap, same as the upload scene block.
    if (reader.tag === tagOf(201, WireType.lengthDelimited)) {
      const c2cReader = new ProtoReader(reader.bytes());
      const c2c: NonNullable<HashSumShape>["bytesPbReserveC2c"] = {};
      while (c2cReader.next()) {
        if (c2cReader.tag === tagOf(2, WireType.lengthDelimited)) c2c.friendUid = c2cReader.string();
        else c2cReader.skip();
      }
      hashSum.bytesPbReserveC2c = c2c;
    } else if (reader.tag === tagOf(202, WireType.lengthDelimited)) {
      const troopReader = new ProtoReader(reader.bytes());
      const troop: NonNullable<HashSumShape>["troopSource"] = {};
      while (troopReader.next()) {
        if (troopReader.tag === tagOf(1, WireType.varint)) troop.groupUin = Number(troopReader.uint64());
        else troopReader.skip();
      }
      hashSum.troopSource = troop;
    } else {
      reader.skip();
    }
  }
  return hashSum;
}

/**
 * Re-encode an upload response as the `MsgInfo` that goes into `commonElem.pbElem`.
 *
 * This is a **re-encode**, not a copy: the reference decodes the response into its
 * message types and then encodes `MsgInfo` from them, which normalises field order and
 * drops anything the client did not model. Copying the raw response bytes produces a
 * `pbElem` the client cannot render.
 *
 * `extBizInfo` is field **2** and is always present on the wire in the reference's
 * `finalizeMediaMsgInfo` (`:37054-37074`), which copies whichever of `pic` / `video` / `ptt`
 * the response carried. It is a separate argument because the voice path has to stamp a
 * computed waveform into it first — the reference mutates the response before re-encoding
 * for exactly this reason (`mergePttWaveform`, `:110756`).
 */
export function encodeMsgInfo(
  upload: NonNullable<UploadResponse["upload"]>,
  extBizInfo?: Ntv2ExtBizInfo,
): Uint8Array {
  const w = new ProtoWriter();
  for (const body of upload.msgInfo?.msgInfoBody ?? []) {
    const bodyWriter = new ProtoWriter();
    if (body.index) {
      const node = new ProtoWriter();
      if (body.index.info) {
        const info = new ProtoWriter();
        info.uint32(1, body.index.info.fileSize);
        info.string(2, body.index.info.fileHash);
        info.string(3, body.index.info.fileSha1);
        info.string(4, body.index.info.fileName);
        node.message(1, info.finish());
      }
      node.string(2, body.index.fileUuid);
      node.uint32(3, body.index.storeId);
      node.uint32(4, body.index.uploadTime);
      node.uint32(5, body.index.ttl);
      node.uint32(6, body.index.subType);
      bodyWriter.message(1, node.finish());
    }
    if (body.picture) {
      const picture = new ProtoWriter();
      picture.string(1, body.picture.urlPath);
      if (body.picture.ext) {
        const ext = new ProtoWriter();
        ext.string(1, body.picture.ext.originalParameter);
        ext.string(2, body.picture.ext.bigParameter);
        ext.string(3, body.picture.ext.thumbParameter);
        picture.message(2, ext.finish());
      }
      picture.string(3, body.picture.domain);
      bodyWriter.message(2, picture.finish());
    }
    if (body.fileExist === true) {
      bodyWriter.uint32(5, 1);
    }
    w.message(1, bodyWriter.finish());
  }
  if (extBizInfo !== undefined) w.message(2, encodeExtBizInfo(extBizInfo));
  return w.finish();
}

// ===========================================================================
// Voice (ptt) and video
// ===========================================================================
// These share every step with the image path above — hash, request a session, PUT the
// chunks, re-encode the response — but differ in enough constants that copying the image
// request wholesale produces a *successful* upload of the wrong thing:
//
//   * `businessType` 3 (voice) / 2 (video), not 1.
//   * `requestId` 3 for video and 4 for a private voice, not 1 (`:37658`, `:110898`).
//   * The `pic` arm carries no `bizType` at all on voice — only `textSummary: "Nya~"`.
//   * Video sends **two** files in one request (`subFileType` 0 and 100) and therefore
//     needs **two** highway PUTs, against the main response for the first and
//     `subFileInfos[0]` for the second.
//
// The reference's own `runNtv2UploadOperation` (`:36966`) treats the sub-files uniformly:
// `sub.source === "top"` names the main upload body, anything else indexes
// `upload.subFileInfos`. That is why the thumbnail is not a second OIDB round-trip.

/** A resolved voice clip, ready for the request. */
interface LoadedPtt {
  bytes: Uint8Array;
  md5Hex: string;
  sha1Hex: string;
  fileSize: number;
  fileName: string;
  duration: number;
  voiceFormat: number;
  waveform?: Uint8Array;
}

/**
 * The `extBizInfo` a voice upload sends.
 *
 * Three deliberate oddities, all from the reference:
 *   * `pic` has `textSummary` and **no `bizType`** — the image path always sets `bizType`,
 *     and copying that here changes what the receiver renders.
 *   * `bytesReserve` is the four-byte literal `08 00 38 00`, not empty.
 *   * `bytesGeneralFlags` is **group only**. A private voice omits the field rather than
 *     sending it zero-length.
 */
function pttExtBizInfo(ptt: LoadedPtt, isGroup: boolean): Ntv2ExtBizInfo {
  return {
    pic: { textSummary: MEDIA_PIC_SUMMARY },
    video: { bytesPbReserve: EMPTY_BYTES },
    ptt: {
      bytesReserve: PTT_BYTES_RESERVE,
      bytesPbReserve: EMPTY_BYTES,
      ...(isGroup ? { bytesGeneralFlags: PTT_GROUP_BYTES_GENERAL_FLAGS } : {}),
      ...(ptt.waveform !== undefined ? { waveform: ptt.waveform } : {}),
    },
  };
}

/** The `extBizInfo` a video upload sends (`:37699-37713`). */
function videoExtBizInfo(): Ntv2ExtBizInfo {
  return {
    pic: { bizType: 0, textSummary: MEDIA_PIC_SUMMARY },
    video: { bytesPbReserve: VIDEO_BYTES_PB_RESERVE },
    // Present but empty on every video, both scenes.
    ptt: {
      bytesPbReserve: EMPTY_BYTES,
      bytesReserve: EMPTY_BYTES,
      bytesGeneralFlags: EMPTY_BYTES,
    },
  };
}

/**
 * Upload one voice clip and return the `MsgInfo` **and** the compatibility blob.
 *
 * The two return values are not interchangeable. `msgInfo` is the modern `commonElem`
 * payload; `compatQMsg` is the legacy `Anonymous{ptt}` blob the client needs in order to
 * play a single voice message in a direct private chat (`:110962-110965`). A group upload
 * leaves it unset, and `makePttElem` already handles that.
 */
export async function uploadPtt(
  context: MediaUploadContext,
  segment: RecordSegment,
): Promise<MediaUploadResult> {
  // `noByteFallback` — the reference's `pttPayloadFromFingerprint`
  // (reference/index.mjs:110780). Same reason as `uploadImage`: a forward node decoded off
  // the wire has no readable byte source, so re-forwarding a voice message would otherwise
  // die in `resolveSegmentBytes` with "media segment has no file source".
  //
  // `fastOnly: true` in the reference is what arms the `fastOnlyError` below: the server is
  // expected to answer with an EMPTY `uKey` (it already has the bytes) and a server that
  // demands bytes instead is a real error, not something to paper over with a zero-length
  // POST.
  if (segment.noByteFallback === true) {
    if (!segment.md5Hex || !segment.sha1Hex) {
      throw new Error("record fast-upload requires md5Hex + sha1Hex");
    }
    const fingerprintPtt: LoadedPtt = {
      bytes: new Uint8Array(0),
      md5Hex: segment.md5Hex,
      sha1Hex: segment.sha1Hex,
      fileSize: segment.fileSize ?? 0,
      fileName: segment.fileName ?? `${segment.md5Hex}.amr`,
      duration: segment.duration ?? 1,
      voiceFormat: segment.voiceFormat ?? NTV2_VOICE_FORMAT_DEFAULT,
      ...(context.pttWaveform !== undefined ? { waveform: context.pttWaveform } : {}),
    };
    return await runPttUpload(context, fingerprintPtt, true);
  }

  const bytes = await resolveSegmentBytes(segment);
  const md5Hex = createHash("md5").update(bytes).digest("hex");
  const ptt: LoadedPtt = {
    bytes,
    md5Hex,
    sha1Hex: createHash("sha1").update(bytes).digest("hex"),
    fileSize: bytes.length,
    // The reference's silk path names the file after the md5 with an `.amr` extension even
    // though the bytes are silk (`:110846`). The extension is a label the client shows,
    // not a format declaration — `fileInfo.type.voiceFormat` is what says "silk".
    fileName: segment.fileName ?? `${md5Hex}.amr`,
    // `loadPtt` always produces a duration from the transcode; the fingerprint-only path
    // defaults it to 1 (`:110789`). A missing duration is far more likely to be a caller
    // bug than a zero-length recording, and `time: 0` makes the client render "0s".
    duration: segment.duration ?? 1,
    voiceFormat: segment.voiceFormat ?? NTV2_VOICE_FORMAT_DEFAULT,
    ...(context.pttWaveform !== undefined ? { waveform: context.pttWaveform } : {}),
  };

  return await runPttUpload(context, ptt, false);
}

/**
 * The two-request voice upload, shared by the byte path and the fingerprint path.
 *
 * Split out for the same reason `runImageUpload` is: a second copy would let the two
 * drift on `requestId`/`compatQmsgSceneType`/`extBizInfo`, and those are the constants that
 * silently produce a voice message the client cannot play.
 *
 * `fastOnly` sets `fastOnlyError`, so a server that demands bytes is an explicit failure
 * rather than a zero-length POST.
 */
async function runPttUpload(
  context: MediaUploadContext,
  ptt: LoadedPtt,
  fastOnly: boolean,
): Promise<MediaUploadResult> {
  const fileInfo: Ntv2FileInfo = {
    fileSize: ptt.fileSize,
    fileHash: ptt.md5Hex,
    fileSha1: ptt.sha1Hex,
    fileName: ptt.fileName,
    // All three format discriminators are written explicitly, including the two zeros.
    // `ProtoWriter.uint32` drops zeros, so the zeros cost nothing — but `voiceFormat` is
    // the one field that tells the server this is a voice rather than a broken image.
    type: {
      type: Ntv2MediaType.voice,
      picFormat: 0,
      videoFormat: 0,
      voiceFormat: ptt.voiceFormat,
    },
    width: 0,
    height: 0,
    time: ptt.duration,
    // 1 marks an image as "the original"; for voice the reference sends 0 (`:110915`).
    original: 0,
  };

  const upload = await requestMediaUpload(context, {
    command: context.isGroup ? NTV2_UPLOAD_COMMANDS.groupVoice : NTV2_UPLOAD_COMMANDS.privateVoice,
    serviceCmd: context.isGroup
      ? NTV2_UPLOAD_SERVICE_CMDS.groupVoice
      : NTV2_UPLOAD_SERVICE_CMDS.privateVoice,
    // 1 for group, 4 for private — the single most surprising constant in this file.
    requestId: context.isGroup ? NTV2_REQUEST_IDS.pttGroup : NTV2_REQUEST_IDS.pttPrivate,
    businessType: Ntv2BusinessType.voice,
    uploadInfo: [{ fileInfo, subFileType: NTV2_SUB_FILE_TYPE_PRIMARY }],
    compatQmsgSceneType: context.isGroup ? 2 : 1,
    extBizInfo: pttExtBizInfo(ptt, context.isGroup),
    puts: [
      {
        source: "top",
        bytes: ptt.bytes,
        md5Hex: ptt.md5Hex,
        commandId: context.isGroup ? HIGHWAY_CMD_IDS.groupPtt : HIGHWAY_CMD_IDS.privatePtt,
        fileIndex: 0,
        ...(fastOnly
          ? { fastOnlyError: "record fast-upload not available (server requires bytes)" }
          : {}),
      },
    ],
  });

  // Step 4. The waveform reaches the outgoing element only through `extBizInfo`, which is
  // why the reference stamps it onto the response before re-encoding (`mergePttWaveform`,
  // `:110756`) instead of appending it to the bytes afterwards.
  const extBizInfo = mergePttWaveform(upload.msgInfo?.extBizInfo, ptt.waveform);
  return {
    msgInfo: encodeMsgInfo(upload, extBizInfo),
    ...(upload.compatQMsg !== undefined ? { compatQMsg: upload.compatQMsg } : {}),
  };
}

/**
 * Stamp a computed waveform into the response's `extBizInfo` before re-encoding.
 *
 * A no-op when there is no waveform, matching the reference — which is the common case in
 * this port, because the waveform is produced by the native addon from the silk file and
 * there is no addon here.
 */
function mergePttWaveform(
  extBizInfo: Ntv2ExtBizInfo | undefined,
  waveform: Uint8Array | undefined,
): Ntv2ExtBizInfo | undefined {
  if (waveform === undefined || waveform.length === 0) return extBizInfo;
  return { ...(extBizInfo ?? {}), ptt: { ...(extBizInfo?.ptt ?? {}), waveform } };
}

/** A resolved video plus its thumbnail, both ready for the request. */
interface LoadedVideo {
  bytes: Uint8Array;
  md5Hex: string;
  sha1Hex: string;
  fileSize: number;
  duration: number;
  width: number;
  height: number;
  thumb: {
    bytes: Uint8Array;
    md5Hex: string;
    sha1Hex: string;
    width: number;
    height: number;
  };
}

/**
 * Resolve a video and its thumbnail.
 *
 * The reference extracts a frame with the native FFmpeg addon and falls back to a bundled
 * 720×1280 PNG when that fails (`:37530-37570`). This port has no addon, so a caller
 * supplied `thumbUrl` is used when present and the bundled PNG otherwise. The fallback
 * bytes are the reference's own `FALLBACK_THUMB` (`:37494`), not a substitute: the server
 * stores the thumbnail under a slot keyed by its md5, so a different image would attach to
 * the wrong slot.
 */
async function loadVideo(segment: VideoSegment): Promise<LoadedVideo> {
  const bytes = await resolveSegmentBytes(segment);
  // `thumbUrl` accepts the same forms as `url`, so it goes through the same resolver.
  const thumbBytes =
    segment.thumbUrl !== undefined && segment.thumbUrl !== ""
      ? await resolveSegmentBytes({ type: "image", imageUrl: segment.thumbUrl })
      : fallbackVideoThumb();

  // The thumbnail's dimensions are read from its own header: the request carries them in
  // the SECOND `uploadInfo` entry, and they drive the preview the receiver draws.
  const thumbPicFormat = detectPicFormat(thumbBytes);
  const thumbDims = imageDimensions(thumbBytes, thumbPicFormat);
  const thumbWidth = thumbDims.width || 1;
  const thumbHeight = thumbDims.height || 1;

  return {
    bytes,
    md5Hex: createHash("md5").update(bytes).digest("hex"),
    sha1Hex: createHash("sha1").update(bytes).digest("hex"),
    fileSize: bytes.length,
    // Same reasoning as the voice duration: without a probe the honest fallback is 1, and
    // the reference's own no-probe path uses exactly that (`:37562`).
    duration: segment.duration ?? 1,
    // The reference derives these from the element, then the probed info, then this same
    // thumbnail (`:37541-37562`). Note the REQUEST zeroes them for a private send — see
    // `uploadVideo` — so these are only used on the group path.
    width: segment.width ?? thumbWidth,
    height: segment.height ?? thumbHeight,
    thumb: {
      bytes: thumbBytes,
      md5Hex: createHash("md5").update(thumbBytes).digest("hex"),
      sha1Hex: createHash("sha1").update(thumbBytes).digest("hex"),
      width: thumbWidth,
      height: thumbHeight,
    },
  };
}

/**
 * Upload one video (plus its thumbnail) and return the `MsgInfo`.
 *
 * No `compatQMsg`: unlike voice, the reference returns only the encoded bytes (`:37735`).
 */
export async function uploadVideo(
  context: MediaUploadContext,
  segment: VideoSegment,
): Promise<MediaUploadResult> {
  // `noByteFallback` — the reference's `videoPayloadFromFingerprint`
  // (reference/index.mjs:37511). Same reasoning as image and voice: a forward node decoded
  // off the wire has no readable bytes, so re-forwarding a video would die in
  // `resolveSegmentBytes`.
  //
  // The reference synthesises a fallback thumbnail here rather than reusing the original
  // one (`makeFallbackThumb`, `:37525`): a forward node carries no thumbnail bytes, and the
  // two `uploadInfo` entries must stay parallel. Geometry defaults to the same fallback
  // constants, NOT to 0 — a zero-dimension video is rejected by the client's renderer.
  if (segment.noByteFallback === true) {
    if (!segment.md5Hex || !segment.sha1Hex) {
      throw new Error("video fast-upload requires md5Hex + sha1Hex");
    }
    const thumbBytes = fallbackVideoThumb();
    const thumbPicFormat = detectPicFormat(thumbBytes);
    const thumbDims = imageDimensions(thumbBytes, thumbPicFormat);
    const fingerprintVideo: LoadedVideo = {
      bytes: new Uint8Array(0),
      md5Hex: segment.md5Hex,
      sha1Hex: segment.sha1Hex,
      fileSize: segment.fileSize ?? 0,
      duration: segment.duration ?? 1,
      width: segment.width ?? thumbDims.width,
      height: segment.height ?? thumbDims.height,
      thumb: {
        bytes: thumbBytes,
        md5Hex: createHash("md5").update(thumbBytes).digest("hex"),
        sha1Hex: createHash("sha1").update(thumbBytes).digest("hex"),
        width: thumbDims.width || 1,
        height: thumbDims.height || 1,
      },
    };
    return await runVideoUpload(context, segment, fingerprintVideo, true);
  }

  const video = await loadVideo(segment);

  return await runVideoUpload(context, segment, video, false);
}

/**
 * The video upload (two `uploadInfo` entries, two highway PUTs), shared by both paths.
 *
 * `fastOnly` arms the `fastOnlyError` strings below. The thumbnail PUT is armed separately
 * in the reference (`:1535`), but both belong to the same fingerprint-only decision: if the
 * caller has no video bytes it has no thumbnail bytes either.
 */
async function runVideoUpload(
  context: MediaUploadContext,
  segment: VideoSegment,
  video: LoadedVideo,
  fastOnly: boolean,
): Promise<MediaUploadResult> {
  const uploadInfo: Ntv2UploadInfo[] = [
    {
      fileInfo: {
        fileSize: video.fileSize,
        fileHash: video.md5Hex,
        fileSha1: video.sha1Hex,
        // Hardcoded in the reference, both files (`:37665`, `:37683`). Not derived from the
        // source name: the server uses its own extension when it serves the file back.
        fileName: "nya.mp4",
        type: { type: Ntv2MediaType.video, picFormat: 0, videoFormat: 0, voiceFormat: 0 },
        // Asymmetric on purpose: a group send carries the real geometry, a private send
        // zeroes it (`:37672-37673`). Sending the dimensions in c2c is what the reference
        // does NOT do, and the receiver lays the bubble out wrong when they are present.
        height: context.isGroup ? video.height : 0,
        width: context.isGroup ? video.width : 0,
        time: video.duration,
        original: 0,
      },
      subFileType: NTV2_SUB_FILE_TYPE_PRIMARY,
    },
    {
      fileInfo: {
        fileSize: video.thumb.bytes.length,
        fileHash: video.thumb.md5Hex,
        fileSha1: video.thumb.sha1Hex,
        fileName: "nya.jpg",
        // `type: 1` — the thumbnail is an IMAGE, and `picFormat` is 0 rather than the
        // detected 1000. The reference writes 0 even for a JPEG thumb (`:37685-37689`);
        // sending 1000 here is a plausible-looking change that the server may reject.
        type: { type: Ntv2MediaType.image, picFormat: 0, videoFormat: 0, voiceFormat: 0 },
        height: video.thumb.height,
        width: video.thumb.width,
        time: 0,
        original: 0,
      },
      subFileType: NTV2_SUB_FILE_TYPE_THUMBNAIL,
    },
  ];

  const upload = await requestMediaUpload(context, {
    command: context.isGroup ? NTV2_UPLOAD_COMMANDS.groupVideo : NTV2_UPLOAD_COMMANDS.privateVideo,
    serviceCmd: context.isGroup
      ? NTV2_UPLOAD_SERVICE_CMDS.groupVideo
      : NTV2_UPLOAD_SERVICE_CMDS.privateVideo,
    requestId: NTV2_REQUEST_IDS.video,
    businessType: Ntv2BusinessType.video,
    uploadInfo,
    // **2 in both scenes**, unlike every other media type (`:37697`). A private video with
    // `compatQmsgSceneType: 1` still uploads, and the message is then undeliverable.
    compatQmsgSceneType: 2,
    extBizInfo: videoExtBizInfo(),
    puts: [
      {
        source: "top",
        bytes: video.bytes,
        md5Hex: video.md5Hex,
        commandId: context.isGroup ? HIGHWAY_CMD_IDS.groupVideo : HIGHWAY_CMD_IDS.privateVideo,
        fileIndex: 0,
        ...(fastOnly
          ? { fastOnlyError: "video fast-upload not available (server requires bytes)" }
          : {}),
      },
      {
        // The thumbnail's `uKey` lives in `upload.subFileInfos[0]`, not in the main body.
        // Its `msgInfoBody` entry is index 1, which is what `fileIndex` selects.
        source: 0,
        bytes: video.thumb.bytes,
        md5Hex: video.thumb.md5Hex,
        commandId: context.isGroup
          ? HIGHWAY_CMD_IDS.groupVideoThumb
          : HIGHWAY_CMD_IDS.privateVideoThumb,
        fileIndex: 1,
        ...(fastOnly
          ? { fastOnlyError: "video thumbnail fast-upload not available (server requires bytes)" }
          : {}),
      },
    ],
  });

  return { msgInfo: encodeMsgInfo(upload, upload.msgInfo?.extBizInfo) };
}

/** One file's highway PUT, over bytes already in memory. */
interface MediaPut {
  /** `"top"` for the main upload body, or an index into the response's `subFileInfos`. */
  source: "top" | number;
  bytes: Uint8Array;
  md5Hex: string;
  /** The HIGHWAY `cmdId` — see `HIGHWAY_CMD_IDS`. */
  commandId: number;
  /** Which `msgInfoBody` entry names this file's `fileUuid`. */
  fileIndex: number;
  /**
   * Raised when the server asked for bytes but the caller has none. Named after the
   * reference's `fastOnlyError` (`:37021`): it is a per-file string so the error says which
   * file was missing rather than "upload failed".
   *
   * OPTIONAL because only the fingerprint-only path (`noByteFallback`) arms it. A normal
   * byte-bearing upload always has bytes to send, so a server demanding them is not an
   * error there — the check only makes sense for a caller that deliberately sent none.
   */
  fastOnlyError?: string;
}

/** A complete NTV2 upload request, minus the parts every media type shares. */
interface MediaUploadRequest {
  command: number;
  serviceCmd: string;
  requestId: number;
  businessType: number;
  uploadInfo: Ntv2UploadInfo[];
  compatQmsgSceneType: number;
  extBizInfo: Ntv2ExtBizInfo;
  puts: MediaPut[];
}

/**
 * Send the request, run the PUTs the server asks for, and return the decoded body.
 *
 * Shares the ordering — and the fast-upload rule — with the image path: an empty `uKey` is
 * a success meaning "skip the PUT", not a failure. The difference is that this handles a
 * *list* of files, so a video's thumbnail can hit fast-upload while the video itself does
 * not, and vice versa.
 *
 * Returns the whole upload body rather than just the `MsgInfo` because the voice path also
 * needs `compatQMsg`, and the video path needs the response `extBizInfo`.
 */
async function requestMediaUpload(
  context: MediaUploadContext,
  request: MediaUploadRequest,
): Promise<NonNullable<UploadResponse["upload"]>> {
  const encoded = encodeNtv2UploadEnvelope({
    command: request.command,
    subCommand: NTV2_UPLOAD_SUB_COMMAND,
    body: {
      reqHead: {
        common: { requestId: request.requestId, command: NTV2_UPLOAD_SUB_COMMAND },
        scene: {
          requestType: NTV2_REQUEST_TYPE,
          businessType: request.businessType,
          sceneType: context.isGroup ? Ntv2SceneType.group : Ntv2SceneType.c2c,
          ...(context.isGroup
            ? { group: { groupUin: Number(context.targetIdOrUid) } }
            : { c2c: { accountType: 2, targetUid: context.targetIdOrUid } }),
        },
        client: { agentType: NTV2_AGENT_TYPE },
      },
      upload: {
        uploadInfo: request.uploadInfo,
        tryFastUploadCompleted: true,
        compatQmsgSceneType: request.compatQmsgSceneType,
        extBizInfo: request.extBizInfo,
      },
    },
    reserved: 1,
  });

  const result = await context.bridge.sendRawPacket(request.serviceCmd, encoded);
  if (!result.success || !result.gotResponse || !result.responseData) {
    throw new Error(result.errorMessage || "NTV2 upload request failed");
  }

  const upload = decodeUploadResponse(result.responseData).upload;
  if (!upload) throw new Error("upload response missing msgInfo");
  if (!upload.msgInfo) throw new Error("upload response missing msgInfo");

  // The session is fetched at most once for the whole call: a video does two PUTs but only
  // one bootstrap (`runNtv2UploadOperation` caches it the same way, `:36996`).
  let session: Awaited<ReturnType<HighwaySessionCache["get"]>> | null = null;

  for (const put of request.puts) {
    // `"top"` is the main body; a number indexes the sub-files, which is how the
    // reference names them (`:37008`).
    const target = put.source === "top" ? upload : upload.subFileInfos?.[put.source];
    const uKey = target?.uKey ?? "";

    if (uKey === "") {
      // Fast upload: the server already has these bytes, so the PUT is skipped. This is a
      // SUCCESS for every sub-file independently — a video can hit it for the thumbnail and
      // not for the video. The reference `continue`s here unconditionally, even when the
      // caller had no bytes (`:37007-37014`); it does NOT fall through to the
      // `fastOnlyError` branch below.
      continue;
    }
    if (put.bytes.length === 0) {
      // The server asked for bytes and there are none. For voice and video that is fatal:
      // the reference raises the per-upload `fastOnlyError` message (`:37020-37023`).
      throw new Error(put.fastOnlyError);
    }
    // A sub-file the server did not describe has no `uKey` and no `msgInfoBody` entry to
    // acknowledge, so there is nothing to PUT against (`:37024`).
    if (target === undefined) continue;

    session ??= await (
      context.sessionCache ?? new HighwaySessionCache(bridgeSessionTransport(context.bridge))
    ).get();

    const hashes = await blockHashes(put.bytes.length, (offset, length) =>
      Promise.resolve(put.bytes.subarray(offset, offset + length)),
    );
    const extend = buildHighwayExtend(
      uKey,
      { msgInfoBody: upload.msgInfo.msgInfoBody ?? [] },
      target.ipv4s ?? [],
      hashes,
      put.fileIndex,
    );
    await (context.putChunks ?? uploadHighway)(new BufferChunkSource(put.bytes), {
      uin: String(context.bridge.identity?.uin ?? ""),
      // The HIGHWAY cmdId, not the OIDB command — see HIGHWAY_CMD_IDS.
      commandId: put.commandId,
      session,
      fileMd5: new Uint8Array(Buffer.from(put.md5Hex, "hex")),
      extend,
    });
  }

  return upload;
}

/**
 * Build a `MediaUploader` bound to one send context.
 *
 * This is the function `action-context-host.ts` should call to populate
 * `SendContext.uploadMedia`. It dispatches on the segment type so the element builder
 * stays unaware of the pipeline.
 */
export function createMediaUploader(context: MediaUploadContext): MediaUploader {
  return async (segment) => {
    switch (segment.type) {
      case "image":
        return uploadImage(context, segment);
      case "record":
        return uploadPtt(context, segment);
      case "video":
        return uploadVideo(context, segment);
      default:
        // Unreachable through `MediaUploader`'s parameter type; kept because a JS caller
        // can pass anything, and silently uploading an unknown type as an image is worse
        // than a specific error.
        throw new Error(
          `media upload for segment type ${JSON.stringify((segment as { type?: unknown }).type ?? "unknown")} is not implemented`,
        );
    }
  };
}
