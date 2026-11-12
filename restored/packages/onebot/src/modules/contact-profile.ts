// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/modules/contact-profile.ts"
// original bundle lines 11195-11244  (48 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function formatPrivilege(value) {
	return {
		...value.type !== void 0 ? { type: value.type } : {},
		...value.level !== void 0 ? { level: value.level } : {},
		...value.flag !== void 0 ? { flag: value.flag } : {},
		...value.isBig !== void 0 ? { is_big: value.isBig } : {},
		...value.jumpUrl !== void 0 ? { jump_url: value.jumpUrl } : {},
		...value.iconUrl !== void 0 ? { icon_url: value.iconUrl } : {},
		...value.deluxeIconUrl !== void 0 ? { deluxe_icon_url: value.deluxeIconUrl } : {}
	};
}
function formatPublicProfile(profile = {}) {
	const result = {};
	for (const [source, target] of [
		["sign", "long_nick"],
		["sex", "sex"],
		["age", "age"],
		["level", "level"],
		["birthdayYear", "birthday_year"],
		["birthdayMonth", "birthday_month"],
		["birthdayDay", "birthday_day"],
		["phoneNum", "phone_num"],
		["email", "email"],
		["country", "country"],
		["province", "province"],
		["city", "city"],
		["college", "college"],
		["vipFlag", "is_qq_vip"],
		["svipFlag", "is_vip"],
		["yearVipFlag", "is_years_vip"],
		["vipLevel", "vip_level"]
	]) if (profile[source] !== void 0) result[target] = profile[source];
	if (profile.privilegeIcons !== void 0) result.privilege_icons = {
		...profile.privilegeIcons.jumpUrl !== void 0 ? { jump_url: profile.privilegeIcons.jumpUrl } : {},
		open: profile.privilegeIcons.open.map(formatPrivilege),
		closed: profile.privilegeIcons.closed.map(formatPrivilege)
	};
	return result;
}
function formatFriend(friend, categoryId = friend.categoryId) {
	return {
		user_id: friend.uin,
		nickname: friend.nickname,
		remark: friend.remark,
		...categoryId !== void 0 ? { category_id: categoryId } : {},
		...formatPublicProfile(friend.profile)
	};
}
export {};
