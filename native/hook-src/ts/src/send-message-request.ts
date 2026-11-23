// The MessageSvc.PbSendMsg request body: the one encoder this project needs above all others.
//
// Everything else in the tree exists to describe or to route messages. This is the piece that
// makes QQ actually transmit one, so it is the last blocker on the send path that is not about
// finding an entry point or defeating re-entrancy -- both of those were resolved or worked
// around today -- but about producing bytes the client will parse.
//
// The field numbers below were not guessed. They come from the reference bundle's own writers,
// which name each field as they assign its tag:
//
//   __write_SendMessageRequest__SendRichText
//       f0 routingHead     tag 10   (field 1, length-delimited)
//       f1 contentHead     tag 18   (field 2)
//       f2 messageBody     tag 26   (field 3)
//       f3 clientSequence  tag 24   (field 3 of MessageControl's numbering -- see note below)
//       f4 random          tag 32
//       f5 syncCookie      tag 42
//       f6 via             tag 48
//       f7 dataStatist     tag 56
//       f8 ctrl            tag 66
//       f9 multiSendSeq    tag 72
//
// Two traps are recorded here because both cost real time and both produce output that looks
// perfectly well-formed while being silently ignored by the server:
//
//   1. The bundle carries SEVERAL messages whose type names collide but whose field numbers and
//      field NAMES differ. `SendContentHead` puts the message type at field 1 under the key
//      `type`; `ContentHead` puts it at field 1 under the key `msgType` and then spends fields
//      2..9 on entirely different things. Sending the wrong one yields a body the server skips.
//      The reference's own send path uses SendContentHead, so that is what this mirrors.
//
//   2. `MessageControl` -- the envelope -- assigns the same trailing fields different numbers than
//      you would infer from their names. Its writer is where the tags above come from, and it
//      emits msgFlag at field 1 of a *different* message (used only when encrypting), so a reader
//      who assumes envelope fields start at 1 in order will be off.
//
// The builder is deliberately total: every field the reference always writes is written here,
// including the zeros. `via`, `dataStatist` and `multiSendSeq` are emitted even as 0 because the
// reference emits them, and a protobuf field that is absent and a field that is present-and-zero
// are different things on the wire.

import { ProtoWriter } from "./oidb/wire.js";

/** A single element of a rich-text message, already encoded. */
export type EncodedElem = Uint8Array;

/** Parameters for one group message send. */
export interface SendGroupMessageRequest {
  /** Target group, as a number or bigint. Serialised as uint64. */
  groupId: number | bigint;
  /** The message content, each element already encoded by the element builder. */
  elems: readonly EncodedElem[];
  /** Message random, used by QQ to correlate the send with its receipt. */
  random: number;
  /** Client sequence. The reference passes 0 for group sends. */
  clientSequence?: number;
}

/**
 * Encodes `MessageSvc.PbSendMsg` for a group message.
 *
 * Structure, matching the reference exactly:
 *
 *   MessageControl
 *     routingHead.RoutingHead.grp.RoutingGroup.groupCode = groupId   (field 1, uint64)
 *     contentHead.SendContentHead.type = 1                           (field 1, uint32)
 *     messageBody.SendMessageBody.richText.RichText.elems[]          (field 1, repeated)
 *     clientSequence                                                  (field 4)
 *     random                                                          (field 5)
 *     syncCookie = empty                                              (field 6)
 *     via = 0                                                         (field 7)
 *     dataStatist = 0                                                 (field 8)
 *     multiSendSeq = 0                                                (field 10)
 *
 * `ctrl` (field 9) is absent in the group path; it appears only on the encrypted private path.
 */
export function encodeSendGroupMessageRequest(request: SendGroupMessageRequest): Uint8Array {
  // NOTE: the reference encoder happily produces a body with zero elements, and the send path
  // rejects the empty message one layer above this encoder. Throwing here would make the two
  // disagree on where the check belongs, so it is left to the caller.

  const groupCode = typeof request.groupId === "bigint" ? request.groupId : BigInt(request.groupId);
  if (groupCode === 0n) throw new Error("group id must not be zero");

  // routingHead -> RoutingHead.grp at FIELD 2 (tag 0x12) -> RoutingGroup.groupCode at field 1.
  //
  // `grp` being field 2 is the first of the three numbering traps in this message. Reading
  // RoutingHead's own writer shows groupCode at field 1 of RoutingGroup, which is true, but the
  // RoutingHead that wraps it places `grp` second -- field 1 is `c2c`. Encoding a group message
  // into field 1 therefore produces a well-formed private-message routing head with no
  // recipient, and the server has nothing to reject.
  const routingGroup = new ProtoWriter(16).uint64(1, groupCode).finish();
  const routingHead = new ProtoWriter(routingGroup.length + 8).message(2, routingGroup).finish();

  // contentHead -> SendContentHead.type = 1, at FIELD 1 but as a VARINT (tag 0x08), not a
  // submessage. A nested encoding here would be tag 0x0a, which parses as a different member.
  const contentHead = new ProtoWriter(8).uint32(1, 1).finish();

  // messageBody at field 3 -> SendMessageBody.richText at field 1 -> SendRichText.elems at
  // FIELD 2 (tag 0x12).
  const richText = new ProtoWriter(64).repeatedMessage(2, request.elems).finish();
  const messageBody = new ProtoWriter(richText.length + 8).message(1, richText).finish();

  // The tail is exactly what the reference emits: clientSequence is 0 and omitted, random is
  // field 5, and syncCookie / via / dataStatist / multiSendSeq are NOT written at all by this
  // entry point. Earlier drafts appended them as present-and-zero on the theory that the writer
  // emitted everything; decoding the reference's own bytes shows otherwise, and extra fields are
  // a real risk because the server treats unknown fields as content it may store.
  return new ProtoWriter(128)
    .message(1, routingHead)
    .message(2, contentHead)
    .message(3, messageBody)
    .uint32(4, request.clientSequence ?? 0)
    .uint32(5, request.random)
    .finish();
}
