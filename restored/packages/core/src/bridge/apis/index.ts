/**
* Construct the ApiHub for a Bridge. Called once from the Bridge
* constructor. Eager construction means every Bridge instance pays
* the cost up-front (a few object allocations) — there's no lazy
* path because that would require either a thunk-based wrapper or
* runtime-mutated `apis.xxx` slots, neither of which is worth the
* complexity for ~13 small classes.
*/
function buildApiHub(ctx) {
	return {
		collection: new CollectionApi(ctx),
		message: new MessageApi(ctx),
		contacts: new ContactsApi(ctx),
		groupAdmin: new GroupAdminApi(ctx),
		groupFile: new GroupFileApi(ctx),
		groupAlbum: new GroupAlbumApi(ctx),
		qzone: new QzoneApi(ctx),
		interaction: new InteractionApi(ctx),
		friend: new FriendApi(ctx),
		profile: new ProfileApi(ctx),
		flashTransfer: new FlashTransferApi(ctx),
		forward: new ForwardApi(ctx),
		misc: new MiscApi(ctx),
		extras: new ExtrasApi(ctx),
		web: new WebApi(ctx),
		systemFace: new SystemFaceApi(ctx)
	};
}
