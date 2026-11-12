/**
* Personal QQ-Zone (个人空间) web API: 说说, public recommendations, likes,
* comments and image upload over the cookie-backed Qzone web interfaces,
* reusing the same `getCookies('qzone.qq.com')` plumbing as GroupAlbumApi.
* Distinct from the group-album surface, which lives on GroupAlbumApi.
*/
var QzoneApi = class {
	ctx;
	constructor(ctx) {
		this.ctx = ctx;
	}
	async getProfile(targetUin) {
		return getQzoneProfile(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, targetUin?.toString());
	}
	async setProfile(profile) {
		await setQzoneProfile(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, profile);
	}
	async getPublicCapabilities() {
		return getQzonePublicCapabilities(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin);
	}
	async getPublicFeeds(cursor) {
		return getQzonePublicFeeds(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, cursor);
	}
	async getHomeFeeds(targetUin, cursor) {
		return getQzoneHomeFeeds(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, targetUin?.toString(), cursor);
	}
	async getFeedDetail(tid) {
		return getQzoneFeedDetail(await this.ctx.apis.web.getCookies("qzone.qq.com"), tid);
	}
	async getShareArk(feed) {
		return getQzoneShareArk(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed);
	}
	async getPublicFeedDetail(feed) {
		return getQzonePublicFeedDetail(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed);
	}
	async getPublicComments(feed, cursor) {
		return getQzonePublicComments(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, cursor);
	}
	async getPublicReplies(feed, comment, cursor = "", pageSize = 20) {
		return getQzonePublicReplies(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, comment, cursor, pageSize);
	}
	async setPublicUpvote(feed, enable = true) {
		return setQzonePublicUpvote(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, enable);
	}
	async setPublicLike(feed, enable = true) {
		return setQzonePublicLike(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, enable);
	}
	async setPublicCommentLike(feed, comment, enable = true, reply) {
		return setQzonePublicCommentLike(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, comment, enable, reply);
	}
	async commentPublicFeed(feed, content) {
		return commentQzonePublicFeed(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, {
			uin: this.ctx.identity.uin,
			uid: this.ctx.identity.selfUid ?? "",
			nick: this.ctx.identity.nickname
		}, content);
	}
	async replyPublicFeed(feed, comment, content, reply) {
		return replyQzonePublicFeed(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, {
			uin: this.ctx.identity.uin,
			uid: this.ctx.identity.selfUid ?? "",
			nick: this.ctx.identity.nickname
		}, comment, content, reply);
	}
	async deletePublicComment(feed, comment) {
		return deleteQzonePublicComment(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, comment);
	}
	async deletePublicReply(feed, comment, reply) {
		return deleteQzonePublicReply(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, comment, reply);
	}
	async setPublicFollow(feed, enable = true) {
		return setQzonePublicFollow(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, enable);
	}
	async forwardPublicFeed(feed, reason = "") {
		return forwardQzonePublicFeed(await this.ctx.apis.web.getCookies("qzone.qq.com"), feed, reason);
	}
	/**
	* 获取说说列表。`targetUin` 省略时取机器人自己的空间。
	* `pos` 为起始偏移，`num` 为本页数量（服务端上限约 20/页）。
	*/
	async getMsgList(targetUin, pos = 0, num = 20) {
		const uin = targetUin && targetUin > 0 ? targetUin.toString() : this.ctx.identity.uin;
		return getQzoneMsgList(await this.ctx.apis.web.getCookies("qzone.qq.com"), uin, pos, num);
	}
	/** 获取说说详情和一页评论。省略 targetUin 时使用当前账号。 */
	async getMsgDetail(tid, targetUin, pos = 0, num = 20) {
		const uin = targetUin === void 0 ? this.ctx.identity.uin : String(targetUin);
		return getQzoneMsgDetail(await this.ctx.apis.web.getCookies("qzone.qq.com"), uin, tid, pos, num);
	}
	/**
	* 获取好友动态。页码调用从首页顺序定位；续页优先传上一页的 cursor。
	* 始终以机器人自己的身份拉取好友动态。
	*/
	async getFeeds(pageNum = 1, count = 10, cursor) {
		return getQzoneFeeds(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, pageNum, count, cursor);
	}
	/**
	* 从来源上传图片到 QQ 空间。
	* `source` 支持: file:// 本地路径 | http(s):// URL | base64:// base64数据
	*/
	async uploadImageFromSource(source) {
		return uploadQzoneImageFromSource(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, source);
	}
	/**
	* 发表说说，返回新说说的 tid。始终发到机器人自己的空间。
	* `richType` / `richval`: 带图说说时传 richType=1 和 richval 字符串
	* (多图用 `\t` 连接多个 richval)。纯文字说说省略这两个参数。
	* `ugcRight` / `targetUins`: 查看权限及其作用名单（ugcRight=16/128 时必填）。
	*/
	async publish(content, richType, richval, ugcRight = 1, targetUins) {
		return publishQzoneMsg(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, content, richType, richval, ugcRight, targetUins);
	}
	/** 删除机器人自己空间的一条说说（按 tid）。 */
	async delete(tid) {
		await deleteQzoneMsg(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, tid);
	}
	/**
	* 修改机器人自己空间一条已发说说的查看权限（按 tid）。
	* `ugcRight` / `targetUins` 含义同 publish（16/128 时 targetUins 必填）。
	*/
	async updateRight(tid, ugcRight, targetUins) {
		return updateQzoneMsgRight(await this.ctx.apis.web.getCookies("qzone.qq.com"), this.ctx.identity.uin, tid, ugcRight, targetUins);
	}
	/**
	* 给一条说说点赞/取消赞。`targetUin` 省略时点赞机器人自己空间的说说；
	* 点赞好友说说时传好友 uin（tid 来自 get_qzone_feeds / get_qzone_msg_list）。
	*/
	async like(tid, targetUin, like, abstime = 0) {
		const selfUin = this.ctx.identity.uin;
		const owner = targetUin && targetUin > 0 ? targetUin.toString() : selfUin;
		await setQzoneLike(await this.ctx.apis.web.getCookies("qzone.qq.com"), selfUin, owner, tid, like, abstime);
	}
	/**
	* 评论一条说说。`targetUin` 为说说所属 QQ 号（省略=机器人自己空间）；
	* 始终以机器人身份发表评论。返回新评论 id（尽力而为）。
	* `richType` / `richval`: 带图评论时传 richType=1 和图片直链 URL
	* (从 uploadImageFromSource 的 url 字段获取)。
	* `reply` 指定父评论及可选回复对象；楼中楼回复仅支持文字。
	*/
	async comment(tid, content, targetUin, richType, richval, reply) {
		if (reply !== void 0 && (richType !== void 0 || richval !== void 0)) throw new Error("images are not supported for Qzone comment replies");
		const selfUin = this.ctx.identity.uin;
		const owner = targetUin && targetUin > 0 ? targetUin.toString() : selfUin;
		const cookieObject = await this.ctx.apis.web.getCookies("qzone.qq.com");
		if (reply !== void 0) return replyQzoneComment(cookieObject, selfUin, owner, tid, content, reply);
		return commentQzoneMsg(cookieObject, selfUin, owner, tid, content, richType, richval);
	}
	/**
	* 拉黑或解除拉黑某人（修改机器人自身 QQ 空间黑名单）。
	* `ban=true` 拉黑，`ban=false` 解除拉黑。
	*/
	async setBlack(targetUin, ban) {
		const selfUin = this.ctx.identity.uin;
		await setQzoneBlack(await this.ctx.apis.web.getCookies("qzone.qq.com"), selfUin, targetUin.toString(), ban);
	}
};
