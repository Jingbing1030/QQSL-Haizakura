// `InteractionApi` — pokes, likes, message reactions, essence messages.
//
// Reference: `../bridge/src/apis/interaction.ts` (reference/index.mjs:296931-296993,
// 63 lines). Every method is a one-line `.invoke(this.ctx, {...})` over a spec that
// `ts/src/oidb/services/` already has, which is why this slice is 63 lines of
// transcription rather than a codec port.
//
// ---------------------------------------------------------------------------
// Six methods, and the two behaviours that are NOT one-liners
// ---------------------------------------------------------------------------
// Four are pure pass-through (`sendPoke`, `sendLike`, `setReaction`, `setEssence`).
// Two are not, and both deviations are the reference's:
//
//   `getEmojiLikes` SWALLOWS the error and answers `{users: [], cookie: "",
//   isLast: true}`. That is not defensive programming I added — it is the
//   reference's own `catch {}` (reference:296971), and it changes the caller's
//   contract: `fetchEmojiLikeUsers` in the action layer wraps THIS in its own
//   try/catch to decide cache-vs-server, so an empty answer here is read as
//   "server has nobody", which is the intended meaning of "the list request
//   failed".
//
//   `fetchReactionSummary` shares its spec with the `_1` sub-command that
//   `get_msg_emoji_likes` uses; it is NOT the per-message reaction list despite
//   the neighbouring name.
//
// ---------------------------------------------------------------------------
// Why `setEssence` takes `random`
// ---------------------------------------------------------------------------
// `0xeac`'s body carries `random` next to `sequence`, and a zero random is dropped
// by the presence rule on the wire. So the caller must pass the message's OWN random
// — passing 0 produces a request that names only the sequence, which the server
// resolves differently. That is why the action layer routes through
// `ctx.setEssenceMsg(messageId)` (which looks the meta up) rather than calling this
// method with an id it does not have.

import type { BridgeContext } from "../context.js";
import { oidbCaller } from "../oidb-invoke.js";
import {
  GetEmojiLikes,
  FetchReactionSummary,
  SendLike,
  SendPoke,
  SetEssence,
  SetReaction,
  sendLikeParams,
  type EmojiLikesPage,
  type ReactionTally,
} from "../../oidb/services/index.js";

const sendPokeCall = oidbCaller(SendPoke);
const sendLikeCall = oidbCaller(SendLike);
const setReactionCall = oidbCaller(SetReaction);
const setEssenceCall = oidbCaller(SetEssence);
const getEmojiLikesCall = oidbCaller(GetEmojiLikes);
const fetchReactionSummaryCall = oidbCaller(FetchReactionSummary);

export class InteractionApi {
  readonly #ctx: BridgeContext;

  constructor(ctx: BridgeContext) {
    this.#ctx = ctx;
  }

  /**
   * `send_poke` / `friend_poke` / `group_poke`.
   *
   * `targetUin` absent means "poke the peer": the spec defaults it to `peerUin`, and
   * the wire then omits it. In a group `peerUin` is the GROUP id and `targetUin` the
   * member, so a group poke with no target pokes the group itself.
   */
  sendPoke(isGroup: boolean, peerUin: number, targetUin?: number | undefined): Promise<void> {
    return sendPokeCall.invoke(this.#ctx, {
      isGroup,
      peerUin,
      targetUin,
    });
  }

  /**
   * `send_like` — `0x7e5_104`. `count` is the OneBot `times` parameter.
   *
   * The spec's `serialize` is SYNCHRONOUS here where the reference's is `async`
   * (it resolves the uid inline, reference:291049). So the uin→uid resolution
   * happens in `sendLikeParams` one layer up, exactly as `ProfileApi.sendLike` does
   * it. `ProfileApi` keeps its own copy for `get_like_list`'s sake; this one exists
   * because `interaction` is where the reference put it, and `send_like` names that
   * path.
   */
  async sendLike(userId: number, count: number): Promise<void> {
    const params = await sendLikeParams({ userId, count }, (uin) =>
      this.#ctx.resolveUserUid(typeof uin === "bigint" ? Number(uin) : uin),
    );
    await sendLikeCall.invoke(this.#ctx, params);
  }

  /** A message reaction; `code`'s LENGTH picks the wire `type` (see the spec). */
  setReaction(groupId: number, sequence: number, code: string, isSet: boolean): Promise<void> {
    return setReactionCall.invoke(this.#ctx, { groupId, sequence, code, isSet });
  }

  /**
   * Essence add/remove — one command (`0xeac`), sub-command chosen by `enable`.
   *
   * `random` must be the target message's own random; see the header.
   */
  setEssence(groupId: number, sequence: number, random: number, enable: boolean): Promise<void> {
    return setEssenceCall.invoke(this.#ctx, { groupId, sequence, random, enable });
  }

  /**
   * The reactor list for one emoji on a group message.
   *
   * ⚠️ A transport failure yields an EMPTY PAGE, not a throw — the reference's own
   * `catch {}` (reference:296971). Do not "fix" this: the action layer distinguishes
   * "server said nobody" from "server unreachable" by comparing the server count it
   * gets here against its own cache, so swallowing is load-bearing.
   */
  async getEmojiLikes(
    groupId: number,
    sequence: number,
    emojiId: string,
    emojiType = 1,
    count = 10,
    cookie = "",
  ): Promise<EmojiLikesPage> {
    try {
      return await getEmojiLikesCall.invoke(this.#ctx, {
        groupId,
        sequence,
        emojiId,
        emojiType,
        count,
        cookie,
      });
    } catch {
      return { users: [], cookie: "", isLast: true };
    }
  }

  /** Recent-used emoji catalogue (`0x9084_1`). NOT a per-message reaction list. */
  fetchReactionSummary(groupId: number, sequence: number): Promise<ReactionTally[]> {
    return fetchReactionSummaryCall.invoke(this.#ctx, { groupId, sequence });
  }
}