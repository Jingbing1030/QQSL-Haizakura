// The OIDB service catalogue, first tier.
//
// "First tier" = the eight commands that cover the most OneBot actions.  The
// counts come from ONEBOT-ACTION-SPEC.md's action table, cross-checked against
// what the reference actually issues (two entries disagree with the spec doc —
// see 0x10c0.ts and docs/oidb.md):
//
//   command     actions  sub-commands used here
//   0x8b7_5         9    group share card
//   0x12b6_0        7    friend share card
//   0x89a_0/15      6    group settings (6 actions on _0, 1 on _15)
//   0x10c0_1/_2     4    join-request inbox    (spec doc says _0; see below)
//   0x6d6_0         4    group files (also _2.._5)
//   0xfe5_2         4    group list / detail
//   0x102a_0        0*   pskey   — see note
//   0x102a_1        0*   clientkey — see note
//
// (*) 0x102a has no action of its own: it is the credential source for the 41
//     HTTP-backed actions, which is why it was extracted first despite a zero
//     action count.
//
// Reference: reference/index.mjs:19136 (`invokeOidb`) is the template every
// entry below plugs into.

export {
  HTTPCONN_SESSION_WIRE_NAME,
  HTTPCONN_OUTER_FIELD,
  HTTPCONN_SESSION_REQUEST,
  HTTPCONN_UPLOAD_SERVICE_TYPE,
  HttpConnField,
  HttpConnResponseField,
  HttpConnServerInfoField,
  HttpConnServerAddrField,
  HttpConnSession,
  encodeHttpConn,
  encodeHttpConn0x6FF501Request,
  decodeHttpConnServerAddr,
  decodeHttpConnServerInfo,
  decodeHttpConnResponse,
  decodeHttpConn0x6FF501Response,
  httpConnAddrHost,
  toHighwaySession,
} from "./0x6ff.js";
export type {
  HttpConn,
  HttpConn0x6FF501Request,
  HttpConnServerAddr,
  HttpConnServerInfo,
  HttpConnResponse,
  HttpConn0x6FF501Response,
  HttpConnUploadServer,
  HighwaySession,
  HttpConnSessionDescriptor,
} from "./0x6ff.js";

export {
  CLICK_INLINE_KEYBOARD_COMMAND,
  CLICK_INLINE_KEYBOARD_SUB_COMMAND,
  Oidb0x112eReqField,
  Oidb0x112eRespField,
  ClickInlineKeyboardButton,
  encodeOidb0x112eReq,
  decodeOidb0x112eResp,
} from "./0x112e.js";
export type {
  ClickInlineKeyboardButtonParams,
  ClickInlineKeyboardButtonResult,
  Oidb0x112eReq,
  Oidb0x112eResp,
} from "./0x112e.js";

export {
  PROFILE_COMMAND,
  PROFILE_SUB_COMMAND,
  PROFILE_FIELD_ID,
  OidbSetProfileField,
  ProfileStringItemField,
  ProfileIntItemField,
  Oidb0x112aReqField,
  Oidb0x112aProfileInfoField,
  Oidb0x112aRespField,
  SetProfile,
  SetSelfLongNick,
  hasProfileChanges,
  encodeProfileStringItem,
  encodeProfileIntItem,
  encodeOidbSetProfile,
  encodeOidb0x112aProfileInfo,
  encodeOidb0x112aReq,
  decodeOidb0x112aResp1,
} from "./0x112a.js";
export type {
  SetProfileParams,
  SetSelfLongNickParams,
  OidbSetProfile,
  ProfileStringItem,
  ProfileIntItem,
  Oidb0x112aReq,
  Oidb0x112aProfileInfo,
  Oidb0x112aResp,
} from "./0x112a.js";

export {
  SET_GROUP_ADMIN_COMMAND,
  SET_GROUP_LEAVE_COMMAND,
  SET_GROUP_ADMIN_SUB_COMMAND,
  SET_GROUP_LEAVE_SUB_COMMAND,
  OidbSetAdminField,
  OidbLeaveGroupField,
  SetGroupAdmin,
  SetGroupLeave,
  encodeOidbSetAdmin,
  encodeOidbLeaveGroup,
  setAdminParams,
} from "./0x1096-1097.js";
export type {
  SetGroupAdminParams,
  SetGroupLeaveParams,
  OidbSetAdmin,
  OidbLeaveGroup,
} from "./0x1096-1097.js";

export {
  SEND_LIKE_COMMAND,
  SEND_LIKE_SUB_COMMAND,
  SEND_LIKE_SOURCE_ID,
  GET_LIKE_COMMAND,
  GET_LIKE_SUB_COMMAND,
  GET_LIKE_DEFAULT_LIMIT,
  OidbLikeField,
  Oidb0x7edReqField,
  Oidb0x7edRespField,
  Oidb0x7edUserLikeInfoField,
  Oidb0x7edFavoriteInfoField,
  Oidb0x7edVoteInfoField,
  Oidb0x7edUserInfoField,
  SendLike,
  GetLike,
  encodeOidbLike,
  encodeOidb0x7edReq,
  decodeOidb0x7edUserInfo,
  decodeOidb0x7edFavoriteInfo,
  decodeOidb0x7edVoteInfo,
  decodeOidb0x7edUserLikeInfo,
  decodeOidb0x7edResp,
  deserializeUserInfo,
  getLikeSubCommand,
  sendLikeParams,
  getLikeParams,
} from "./0x7e5-7ed.js";
export type {
  SendLikeParams,
  GetLikeParams,
  OidbLike,
  Oidb0x7edReq,
  Oidb0x7edResp,
  Oidb0x7edUserInfo,
  Oidb0x7edFavoriteInfo,
  Oidb0x7edVoteInfo,
  Oidb0x7edUserLikeInfo,
  ProfileLikeUser,
  ProfileLikeInfo,
  ProfileLikeBucket,
  ProfileLikeFavorite,
  ProfileLikeVote,
} from "./0x7e5-7ed.js";

export {
  GROUP_FILE_SEND_COMMAND,
  GROUP_FILE_SEND_SUB_COMMAND,
  GROUP_FILE_SEND_APP_ID,
  GROUP_FILE_SEND_BUS_ID,
  PUBLISH_RANDOM_MAX,
  GroupSendFileReqField,
  GroupTransFileReqField,
  GroupSendFileBodyField,
  GroupSendFileInfoField,
  GroupSendFileRespField,
  GroupTransFileRespField,
  TransGroupFile,
  PublishGroupFile,
  encodeGroupTransFileReq,
  encodeGroupSendFileInfo,
  encodeGroupSendFileBody,
  encodeGroupSendFileReq,
  decodeGroupTransFileResp,
  decodeGroupSendFileResp,
} from "./0x6d9.js";
export type {
  TransGroupFileParams,
  PublishGroupFileParams,
  TransGroupFileResult,
  GroupTransFileReq,
  GroupSendFileInfo,
  GroupSendFileBody,
  GroupSendFileReq,
  GroupSendFileTransReq,
  GroupSendFileBodyReq,
  GroupTransFileResp,
  GroupSendFileResp,
} from "./0x6d9.js";

export {
  GROUP_FILE_VIEW_COMMAND,
  GROUP_FILE_VIEW_SUB_COMMAND,
  GROUP_FILE_VIEW_APP_ID,
  GROUP_FILE_COUNT_BUS_ID,
  GroupFileViewReqField,
  GroupFileListReqField,
  GroupFileViewRespField,
  GroupFileListRespField,
  GroupFileListItemRespField,
  GroupFileListFolderRespField,
  GroupFileListFileRespField,
  GroupFileCountViewReqField,
  GroupFileCountReqField,
  GroupFileSpaceReqField,
  GroupFileCountViewRespField,
  GroupFileCountRespField,
  GroupFileSpaceRespField,
  ListGroupFilesPage,
  GetGroupFileCount,
  GetGroupFileSpace,
  encodeGroupFileListReq,
  encodeGroupFileViewReq,
  encodeGroupFileCountReq,
  encodeGroupFileSpaceReq,
  encodeGroupFileCountViewReq,
  decodeGroupFileListFolder,
  decodeGroupFileListFile,
  decodeGroupFileListItem,
  decodeGroupFileListResp,
  decodeGroupFileViewResp,
  decodeGroupFileCountResp,
  decodeGroupFileSpaceResp,
  decodeGroupFileCountViewResp,
} from "./0x6d8.js";
export type {
  ListGroupFilesParams,
  GroupFileCountParams,
  GroupFileListPage,
  GroupFileCountResult,
  GroupFileSpaceResult,
  GroupFileListReq,
  GroupFileViewReq,
  GroupFileListResp,
  GroupFileViewResp,
  GroupFileListItem,
  GroupFileListFolder,
  GroupFileListFile,
  GroupFileCountReq,
  GroupFileSpaceReq,
  GroupFileCountViewReq,
  GroupFileCountResp,
  GroupFileSpaceResp,
  GroupFileCountViewResp,
} from "./0x6d8.js";

export {
  GROUP_FILE_FOLDER_COMMAND,
  GROUP_FILE_FOLDER_SUB_COMMAND,
  GroupFileFolderReqField,
  CreateFolderField,
  DeleteFolderField,
  RenameFolderField,
  GroupFileFolderRespField,
  FolderRetRespField,
  FolderInfoRespField,
  CreateGroupFolder,
  DeleteGroupFolder,
  RenameGroupFolder,
  encodeCreateFolder,
  encodeDeleteFolder,
  encodeRenameFolder,
  encodeGroupFileFolderReq,
  decodeFolderInfo,
  decodeFolderRet,
  decodeGroupFileFolderResp,
  checkRetCodeZero,
} from "./0x6d7.js";
export type {
  CreateFolderParams,
  DeleteFolderParams,
  RenameFolderParams,
  CreateFolderBody,
  DeleteFolderBody,
  RenameFolderBody,
  GroupFileFolderReq,
  GroupFileFolderResp,
  FolderRet,
  FolderInfo,
} from "./0x6d7.js";

export {
  GET_PSKEY_COMMAND,
  FORCE_FETCH_CLIENT_KEY_COMMAND,
  GetPskeyReqField,
  PskeyItemField,
  GetPskeyRespField,
  ClientKeyRespField,
  GetPskey,
  ForceFetchClientKey,
  encodeGetPskeyReq,
  encodePskeyItem,
  decodePskeyItem,
  decodeGetPskeyResp,
  encodeClientKeyReq,
  decodeClientKeyResp,
} from "./0x102a.js";
export type {
  GetPskeyParams,
  GetPskeyReq,
  GetPskeyResp,
  GetPskeyResult,
  PskeyItem,
  ClientKeyReq,
  ClientKeyResp,
  ClientKeyResult,
} from "./0x102a.js";

export {
  GET_GROUP_RECOMMEND_ARK_COMMAND,
  GET_BUDDY_RECOMMEND_ARK_COMMAND,
  GroupRecommendArkReqField,
  GroupRecommendArkRespField,
  BuddyRecommendArkReqField,
  BuddyRecommendArkRespField,
  GetGroupRecommendArk,
  GetBuddyRecommendArk,
  encodeGroupRecommendArkReq,
  decodeGroupRecommendArkResp,
  encodeBuddyRecommendArkReq,
  decodeBuddyRecommendArkResp,
  buddyRecommendArkJumpUrl,
} from "./0x8b7-5.js";
export type {
  GroupRecommendArkParams,
  GroupRecommendArkReq,
  GroupRecommendArkResp,
  BuddyRecommendArkParams,
  BuddyRecommendArkReq,
  BuddyRecommendArkResp,
} from "./0x8b7-5.js";

export {
  GROUP_SETTINGS_COMMAND,
  GROUP_SETTINGS_SUB_COMMAND,
  RENAME_GROUP_SUB_COMMAND,
  GroupSettingsEnvelopeField,
  MuteAllStateField,
  AddOptionSettingsField,
  SearchSettingsField,
  InvitePolicySettingsField,
  HistoryVisibilitySettingsField,
  MemberPermissionSettingsField,
  RenameGroupField,
  RenameGroupBodyField,
  MEMBER_INVITE_PRIVILEGE_MASK,
  POLICY_PRIVILEGE_BITS,
  GROUP_MEMBER_PERMISSION_MASKS,
  HISTORY_VISIBLE_FLAG,
  SetGroupWholeBan,
  SetGroupAddOption,
  SetGroupSearch,
  SetGroupMemberInvitePolicy,
  SetGroupNewMemberHistoryVisibility,
  SetGroupMemberPermissions,
  SetGroupName,
  encodeMuteAll,
  encodeAddOption,
  encodeSearch,
  encodeInvitePolicy,
  encodeHistoryVisibility,
  encodeMemberPermission,
  encodeRenameGroup,
  decodeOidbEmpty,
  muteAllState,
  wireAddType,
  isQuestionAddType,
  mergeMemberInvitePrivilegeFlag,
  decodeMemberInvitePolicy,
  mergeGroupMemberPermission,
  decodeGroupMemberPermissions,
} from "./0x89a-0.js";
export type {
  GroupSettingsParams,
  AddOptionParams,
  SearchParams,
  InvitePolicyParams,
  HistoryVisibilityParams,
  MemberPermissionParams,
  MemberInvitePolicy,
  GroupMemberPermission,
  MuteAllBody,
  AddOptionBody,
  SearchBody,
  InvitePolicyBody,
  HistoryVisibilityBody,
  MemberPermissionBody,
  RenameGroupBody,
  OidbEmpty,
} from "./0x89a-0.js";

export {
  GROUP_FILE_COMMAND,
  GROUP_FILE_SUB_COMMAND,
  GroupFileOuterField,
  GroupFileUploadReqField,
  GroupFileDownloadReqField,
  GroupFileDeleteReqField,
  GroupFileRenameReqField,
  GroupFileMoveReqField,
  GroupFileUploadRespField,
  GroupFileDownloadRespField,
  GroupFileRetRespField,
  GroupFileRespOuterField,
  GROUP_FILE_APP_ID,
  GROUP_FILE_BUS_ID,
  GROUP_FILE_ENTRANCE,
  GROUP_FILE_DOWNLOAD_APP_ID,
  UploadGroupFile,
  GetGroupFileUrl,
  DeleteGroupFile,
  RenameGroupFile,
  MoveGroupFile,
  GroupFileRetError,
  ensureRetCodeZero,
  encodeGroupFileUploadReq,
  encodeGroupFileDownloadReq,
  encodeGroupFileDeleteReq,
  encodeGroupFileRenameReq,
  encodeGroupFileMoveReq,
  encodeGroupFileReq,
  decodeGroupFileUploadResp,
  decodeGroupFileDownloadResp,
  decodeGroupFileRetResp,
  decodeGroupFileResp,
} from "./0x6d6.js";
export type {
  GroupFileUploadParams,
  GroupFileUrlParams,
  GroupFileUrlResult,
  GroupFileIdParams,
  GroupFileRenameParams,
  GroupFileMoveParams,
  GroupFileReq,
  GroupFileUploadBody,
  GroupFileDownloadBody,
  GroupFileDeleteBody,
  GroupFileRenameBody,
  GroupFileMoveBody,
  GroupFileResp,
  GroupFileUploadReq,
  GroupFileDownloadReq,
  GroupFileDeleteReq,
  GroupFileRenameReq,
  GroupFileMoveReq,
  GroupFileUploadResp,
  GroupFileDownloadResp,
  GroupFileRetResp,
} from "./0x6d6.js";

export {
  GROUP_LIST_COMMAND,
  GROUP_LIST_SUB_COMMAND,
  GroupListRequestField,
  GroupListConfigField,
  GroupListRespField,
  GroupField,
  GroupInfoField,
  GroupMemberField,
  GroupCustomInfoField,
  GROUP_LIST_CONFIG,
  FetchGroupList,
  FetchGroupDetail,
  encodeGroupListReq,
  decodeGroupMember,
  decodeGroupInfo,
  decodeGroupCustomInfo,
  decodeGroupEntry,
  decodeGroupListResp,
  toGroupSummary,
  isGroupAllMuted,
} from "./0xfe5-2.js";
export type {
  GroupListParams,
  GroupInfoParams,
  GroupListConfig,
  GroupListConfig1,
  GroupListConfig2,
  GroupListConfig3,
  GroupListReq,
  GroupListResp,
  GroupEntry,
  GroupInfo,
  GroupCustomInfo,
  GroupMember,
  GroupSummary,
} from "./0xfe5-2.js";

export {
  GROUP_REQUESTS_COMMAND,
  GROUP_REQUESTS_SUB_COMMAND,
  SET_ADD_REQUEST_COMMAND,
  GroupRequestListField,
  GroupRequestsRespField,
  GroupRequestItemField,
  GroupRequestGroupField,
  GroupRequestUserByUinField,
  GroupRequestUserByUidField,
  GroupRequestActionField,
  GroupRequestBodyField,
  GROUP_REQUEST_OPERATION_TYPE,
  FetchGroupRequests,
  groupRequestOperationType,
  isSelfGroupInvitation,
  isJoinOrInviteNotify,
  formatGroupRequestFlag,
  parseGroupRequestFlag,
  normalizeGroupRequestSequence,
  mergeRequestUser,
  mergeRequestItem,
  mergeRequestList,
  encodeGroupRequestList,
  encodeGroupRequestAction,
  decodeGroupRequestGroup,
  decodeGroupRequestUserByUin,
  decodeGroupRequestUserByUid,
  decodeGroupRequestItemByUin,
  decodeGroupRequestItemByUid,
  decodeGroupRequestsByUin,
  decodeGroupRequestsByUid,
} from "./0x10c0.js";
export type {
  FetchGroupRequestsParams,
  GroupRequestFlag,
  GroupRequestListReq,
  MergedGroupRequestUser,
  MergedGroupRequestItem,
  MergedGroupRequestsPage,
  GroupRequestGroup,
  GroupRequestUserByUin,
  GroupRequestUserByUid,
  GroupRequestItemByUin,
  GroupRequestItemByUid,
  GroupRequestsPage,
  GroupRequestsByUin,
  GroupRequestsByUid,
  GroupRequestActionReq,
} from "./0x10c0.js";
// ---------------------------------------------------------------------------
// Batch B — friendship / profile / settings / misc
// ---------------------------------------------------------------------------
//
// The two known gaps PROGRESS.md row 2.5 recorded are closed here: 0x88d_0 (the
// only source of `group_level`, which 0xfe5_2 does not carry) and 0x10c8 (the
// action half of group-request handling, whose sub-command is 1 or 2 and never 0).
//
// Three of the batch brief's command labels were wrong and two commands it listed
// do not exist at all; each service file states what its real command is.  Notably
// **0x12b7 and 0x12b8 are absent from the reference** — there is no `command =
// 4791/4792` anywhere — so friend-分组 management is 0x1255_0 (write) plus the
// `categories[]` side of 0xfd4_1 (read), with no third command.

export {
  GROUP_DETAIL_COMMAND,
  GROUP_DETAIL_SUB_COMMAND,
  GROUP_DETAIL_REQUEST_FIELD1,
  GROUP_DETAIL_FLAGS,
  GroupDetailRequestField,
  GroupDetailConfigField,
  GroupDetailFlagsField,
  GroupDetailResultsField,
  GroupDetailResponseField,
  GroupDetailInfoField,
  FetchGroupDetail as FetchGroupDetailInfo,
  encodeGroupDetailFlags,
  encodeGroupDetailConfig,
  encodeGroupDetailReq,
  decodeGroupDetailResults,
  decodeGroupDetailInfo,
  decodeGroupDetailResp,
  toGroupDetail,
  GroupDetailFlagsField as GROUP_DETAIL_REQUEST_FIELDS,
  toGroupAdminSettings,
  isGroupDetailAllMuted,
} from "./0x88d.js";
export type {
  GroupDetailFlags,
  GroupDetailConfig,
  GroupDetailRequest,
  GroupDetailResults,
  GroupDetailInfo,
  GroupDetailResp,
  GroupDetailParams,
  GroupDetail,
  GroupAdminSettings,
} from "./0x88d.js";

// `SetAddRequest` re-uses `encodeGroupRequestAction` / `GroupRequestActionField` /
// `GroupRequestBodyField` / `GroupRequestActionReq` from 0x10c0.ts (exported above)
// so the field table exists once.  Only the spec-level names are new here.
export {
  SET_ADD_REQUEST_SUB_COMMAND,
  GROUP_REQUEST_ACCEPT,
  EMPTY_REASON_PLACEHOLDER,
  SetAddRequest,
} from "./0x10c8.js";
// `OidbEmpty` / `decodeOidbEmpty` are already exported from 0x89a-0.js above;
// 0x10c8.ts re-uses that codec rather than declaring a second identical copy.
export type { SetAddRequestParams } from "./0x10c8.js";

export {
  MUTE_MEMBER_COMMAND,
  MUTE_MEMBER_SUB_COMMAND,
  MUTE_MEMBER_TYPE,
  MuteMemberField,
  MuteMemberBodyField,
  MuteMember,
  encodeMuteMember,
  encodeMuteMemberBody,
  decodeMuteMemberResp,
} from "./0x1253.js";
export type { MuteMemberBody, MuteMemberReq, MuteMemberResp, MuteMemberParams } from "./0x1253.js";

export {
  SET_FRIEND_CATEGORY_COMMAND,
  SET_FRIEND_CATEGORY_SUB_COMMAND,
  FRIEND_CATEGORY_ALREADY_APPLIED,
  ACCEPTED_FRIEND_CATEGORY_CODES,
  SetFriendCategoryField,
  SetFriendCategory,
  encodeSetFriendCategoryReq,
  decodeSetFriendCategoryReq,
} from "./0x1255.js";
export type {
  SetFriendCategoryReq,
  SetFriendCategoryResp,
  SetFriendCategoryParams,
} from "./0x1255.js";

export {
  DELETE_FRIEND_COMMAND,
  DELETE_FRIEND_SUB_COMMAND,
  DELETE_FRIEND_STAMP,
  DeleteFriendField,
  DeleteFriendField1Field,
  DeleteFriendField2Field,
  DeleteFriendField2Field3Field,
  DeleteFriend,
  encodeDeleteFriendReq,
  encodeDeleteFriendField1,
  encodeDeleteFriendField2,
  encodeDeleteFriendStamp,
  decodeDeleteFriendResp,
} from "./0x126b.js";
export type {
  DeleteFriendStamp,
  DeleteFriendField1,
  DeleteFriendField2,
  DeleteFriendReq,
  DeleteFriendResp,
  DeleteFriendParams,
} from "./0x126b.js";

export {
  SET_FRIEND_REMARK_COMMAND,
  CLEAR_FRIEND_REMARK_COMMAND,
  SET_FRIEND_REMARK_SUB_COMMAND,
  CLEAR_FRIEND_REMARK_SUB_COMMAND,
  FRIEND_REMARK_SCENE,
  SetFriendRemarkField,
  SetFriendRemarkChangeField,
  FriendRemarkTargetField,
  ClearFriendRemarkField,
  SetFriendRemarkResponseField,
  SetFriendRemarkErrorField,
  SetFriendRemark,
  ClearFriendRemark,
  encodeFriendRemarkTarget,
  encodeSetFriendRemarkReq,
  encodeClearFriendRemarkReq,
  decodeFriendRemarkTarget,
  decodeSetFriendRemarkChange,
  decodeSetFriendRemarkResponse,
  decodeClearFriendRemarkResp,
  checkFriendRemarkResponse,
  confirmFriendRemark,
} from "./0x912e.js";
export type {
  FriendRemarkTarget,
  SetFriendRemarkChange,
  SetFriendRemarkReq,
  ClearFriendRemarkReq,
  SetFriendRemarkError,
  SetFriendRemarkResponse,
  ClearFriendRemarkResp,
  FriendRemarkResult,
  SetFriendRemarkParams,
  ClearFriendRemarkParams,
} from "./0x912e.js";

export {
  USER_INFO_COMMAND,
  USER_INFO_SUB_COMMAND,
  STATUS_PROPERTY_KEY,
  REQUESTED_PROFILE_KEYS,
  UNIQUE_PROFILE_KEYS,
  StrangerStatusReqField,
  StrangerStatusKeyField,
  StrangerStatusRespField,
  StrangerStatusRespDataField,
  StrangerStatusRespPropertiesField,
  StrangerStatusRespPropertyField,
  UserInfoReqField,
  UserInfoByUidReqField,
  UserInfoKeyField,
  UserInfoResponseField,
  UserInfoResponseBodyField,
  UserInfoPropertyField,
  TwoNumberField,
  BytePropertyField,
  CustomStatusField,
  AvatarInfoField,
  ProfilePrivilegesField,
  ProfilePrivilegeListsField,
  ProfilePrivilegeField,
  GetStrangerStatus,
  FetchUserProfile,
  FetchUserProfileByUid,
  withRequestedUin,
  encodeStrangerStatusReq,
  encodeUserInfoReq,
  encodeUserInfoByUidReq,
  decodeStrangerStatusResp,
  decodeUserInfoResponse,
  decodeCustomStatus,
  decodeAvatarInfo,
  decodeProfilePrivileges,
  decodePublicProfile,
  decodeBirthday,
  decodeMembership,
  unpackStatusWord,
  toStrangerStatus,
  toUserProfile,
} from "./0xfe1.js";
export type {
  GetStrangerStatusParams,
  FetchUserProfileParams,
  FetchUserProfileByUidParams,
  StrangerStatusReq,
  StrangerStatusProperty,
  StrangerStatusProperties,
  StrangerStatusData,
  StrangerStatusResp,
  UserInfoReq,
  UserInfoByUidReq,
  TwoNumber,
  ByteProperty,
  UserInfoProperties,
  UserInfoResponseBody,
  UserInfoResponse,
  CustomStatus,
  AvatarInfo,
  UnpackedStatus,
  Membership,
  PublicProfile,
  PrivilegeEntry,
  PrivilegeIcons,
  ProfilePrivilege,
  ProfilePrivilegeLists,
  ProfilePrivileges,
  UserProfile,
} from "./0xfe1.js";
export { PUBLIC_PROFILE_KEYS } from "./0xfe1.js";

export {
  FRIEND_LIST_COMMAND,
  FRIEND_LIST_SUB_COMMAND,
  FRIEND_LIST_PAGE_SIZE,
  FRIEND_LIST_FIELD6,
  FRIEND_LIST_FIELD7,
  FRIEND_LIST_FIELD10003,
  FRIEND_LIST_FIELD10002,
  FRIEND_DETAIL_KEYS,
  FRIEND_BASE_KEYS,
  FriendListRequestField,
  FriendListBodyItemField,
  FriendListNumberField,
  FriendListResponseField,
  FriendField,
  FriendAdditionalField,
  FriendLayer1Field,
  FriendNumberPropertyField,
  FriendPropertyField,
  FriendCategoryField,
  FetchFriendListPage,
  encodeFriendListRequest,
  encodeFriendListBodyItem,
  encodeRepeatedUint32,
  decodeFriendListResponse,
  friendProperties,
  mapFriend,
  toFriendListPage,
} from "./0xfd4.js";
export type {
  FetchFriendListPageParams,
  FriendListBodyItem,
  FriendListRequest,
  FriendNumberProperty,
  FriendProperty,
  FriendLayer1,
  FriendAdditional,
  Friend,
  FriendCategory,
  FriendListResponse,
  FriendEntry,
  FriendListItem,
  FriendListPage,
} from "./0xfd4.js";

export {
  GROUP_MEMBER_LIST_COMMAND,
  GROUP_MEMBER_LIST_SUB_COMMAND,
  GROUP_MEMBER_LIST_FIELD2,
  GROUP_MEMBER_LIST_FIELD3,
  GROUP_MEMBER_LIST_ALL_TRUE,
  GroupMemberListRequestField,
  GroupMemberListBodyField,
  GroupMemberListResponseField,
  GroupMemberField as GroupMemberRosterField,
  GroupMemberUinField,
  GroupMemberCardField,
  GroupMemberLevelField,
  FetchGroupMemberListPage,
  encodeGroupMemberListBody,
  encodeGroupMemberListRequest,
  decodeGroupMemberListResponse,
  permissionToRole,
  toGroupMemberListPage,
} from "./0xfe7.js";
export type {
  FetchGroupMemberListPageParams,
  GroupMemberListBody,
  GroupMemberListRequest,
  GroupMemberUin,
  GroupMemberCard,
  GroupMemberLevel,
  GroupMember as GroupMemberRoster,
  GroupMemberListResponse,
  GroupMemberRole,
  GroupMemberEntry,
  GroupMemberListPage,
} from "./0xfe7.js";

export {
  GROUP_PTT_URL_COMMAND,
  GROUP_PTT_URL_SUB_COMMAND,
  PTT_REQUEST_ID,
  PTT_COMMAND,
  PTT_REQUEST_TYPE,
  PTT_BUSINESS_TYPE,
  PTT_SCENE_TYPE,
  PTT_AGENT_TYPE,
  RichMediaReqField,
  ReqHeadField,
  CommonHeadField,
  SceneInfoField,
  GroupInfoField as PttGroupInfoField,
  ClientMetaField,
  DownloadReqField,
  IndexNodeField,
  FileInfoField,
  FileTypeField,
  DownloadExtField,
  VideoDownloadExtField,
  RichMediaRespField,
  RespHeadField,
  MediaDownloadRespField,
  MediaDownloadInfoField,
  GetGroupPttUrl,
  normalizeMediaNode,
  encodeRichMediaReq,
  encodeReqHead,
  encodeCommonHead,
  encodeSceneInfo,
  encodeGroupInfo,
  encodeClientMeta,
  encodeDownloadReq,
  encodeIndexNode,
  encodeFileInfo,
  encodeFileType,
  encodeDownloadExt,
  encodeVideoDownloadExt,
  decodeRichMediaResp,
  ensureRetCodeZero as ensureNtv2RetCodeZero,
  parseNtv2DownloadUrl,
} from "./0x126e.js";
export type {
  GetGroupPttUrlParams,
  MediaNodeLike,
  FileType,
  FileInfo,
  IndexNode,
  VideoDownloadExt,
  DownloadExt,
  DownloadReq,
  CommonHead,
  GroupInfo as PttGroupInfo,
  SceneInfo,
  ClientMeta,
  ReqHead,
  RichMediaReq,
  RichMediaCommonHead,
  RichMediaRespHead,
  MediaDownloadInfo,
  MediaDownloadResp,
  RichMediaResp,
} from "./0x126e.js";

export {
  FLASH_DOWNLOAD_COMMAND,
  FLASH_DOWNLOAD_SUB_COMMAND,
  FLASH_APPLY_HEAD_CONFIG,
  FLASH_FILE_INFO5,
  FLASH_PARAM,
  FLASH_FILESET_EXTRA_FIELD3,
  FlashDownloadReqField,
  FlashApplyHeadField,
  FlashApplyHeadSubField,
  FlashApplyHeadConfigField,
  FlashApplyFlag2Field,
  FlashDownloadPayloadField,
  FlashDownloadWrapperField,
  FlashFileInfoField,
  FlashFileInfo5Field,
  FlashDownloadPayload2Field,
  FlashDownloadParamField,
  FlashDownloadParam6Field,
  FlashDownloadFlag4Field,
  FlashFilesetWrapField,
  FlashDownloadRespField,
  FlashApplyHeadRespField,
  GetFlashDownload,
  peekFlashSequence,
  resetFlashSequence,
  encodeFlashDownloadReq,
  encodeFlashApplyHead,
  encodeFlashApplyHeadSub,
  encodeFlashApplyHeadConfig,
  encodeFlashApplyFlag2,
  encodeFlashFileInfo5,
  encodeFlashFileInfo,
  encodeFlashDownloadWrapper,
  encodeFlashDownloadParam,
  encodeFlashDownloadParam6,
  encodeFlashFilesetWrap,
  encodeFlashDownloadPayload,
  encodeFlashDownloadPayload2,
  decodeFlashDownloadResp,
  parseFlashDownloadUrl,
} from "./0x12a9.js";
export type {
  GetFlashDownloadParams,
  FlashApplyHeadSub,
  FlashApplyHeadConfig,
  FlashApplyHead,
  FlashFileInfo5,
  FlashFileInfo,
  FlashDownloadWrapper,
  FlashDownloadParam6,
  FlashDownloadParam,
  FlashFilesetWrap,
  FlashDownloadPayload2,
  FlashDownloadPayload,
  FlashDownloadReq,
  FlashApplyHeadResp,
  FlashDownloadResp,
} from "./0x12a9.js";

// ---------------------------------------------------------------------------
// Batch C — group admin / group settings / category tags
// ---------------------------------------------------------------------------
//
// All 23 labels in this batch's brief resolve to real specs, and every one of them
// uses the reference's own variable name as its label — the first batch where the
// naming was accurate. Two of the 23 were *already* implemented by batch A, and
// four more by the pre-existing 0x89a-0.ts; those are re-exported below under
// their brief names rather than re-implemented, because a second copy of the same
// codec is how a byte subtly diverges.
//
// The batch's one genuine novelty is that **five labels map onto only two
// command numbers**: SetMemberInvitePolicy / SetNewMemberHistoryVisibility /
// SetMemberPermission / SetSearch / SetAddOption are all `0x89a_0`, told apart
// solely by which settings submessage they populate. And 0x8a0_1 carries two
// entirely different request messages under one command/sub.

export {
  KICK_MEMBER_COMMAND,
  KICK_MEMBER_SUB_COMMAND,
  OidbKickMemberField,
  Oidb0x8a0ReqField,
  OidbKickMemberResponseField,
  OidbKickMemberResultField,
  KickMember,
  KickMembers,
  encodeOidbKickMember,
  encodeOidb0x8a0Req,
  decodeOidbKickMemberResult,
  decodeOidbKickMemberResponse,
  checkKickResults,
  kickMemberParams,
  kickMembersParams,
} from "./0x8a0.js";
export type {
  KickMemberParams,
  KickMembersParams,
  OidbKickMember,
  Oidb0x8a0Req,
  OidbKickMemberResult,
  OidbKickMemberResponse,
} from "./0x8a0.js";

export {
  GET_AT_ALL_REMAIN_COMMAND,
  GET_AT_ALL_REMAIN_SUB_COMMAND,
  GET_AT_ALL_REMAIN_BASIC,
  Oidb0x8a7ReqField,
  Oidb0x8a7RespField,
  GetAtAllRemain,
  encodeOidb0x8a7Req,
  decodeOidb0x8a7Resp,
  toAtAllRemain,
} from "./0x8a7.js";
export type {
  GetAtAllRemainParams,
  AtAllRemain,
  Oidb0x8a7Req,
  Oidb0x8a7Resp,
} from "./0x8a7.js";

// `OidbEmpty` / `decodeOidbEmpty` already come from 0x89a-0.js above; the admin
// permission writes re-use that codec rather than declaring a duplicate.
export {
  GET_ADMIN_PERMISSIONS_COMMAND,
  SET_ADMIN_PERMISSIONS_COMMAND,
  GET_ADMIN_RECEIVE_VERIFY_COMMAND,
  SET_ADMIN_RECEIVE_VERIFY_COMMAND,
  GET_ADMIN_PERMISSIONS_SUB_COMMAND,
  SET_ADMIN_PERMISSIONS_SUB_COMMAND,
  GET_ADMIN_RECEIVE_VERIFY_SUB_COMMAND,
  SET_ADMIN_RECEIVE_VERIFY_SUB_COMMAND,
  ADMIN_PERMISSIONS_ENVELOPE_FIELD,
  ADMIN_RECEIVE_VERIFY_FLAG_FIELD,
  RECEIVE_VERIFY_DISABLED_BIT,
  KICK_MEMBER_PER_DAY_ALLOWED,
  ADMIN_PERMISSION_ITEM,
  ADMIN_PERMISSION_VALUE,
  GetGroupAdminPermissionsRequestField,
  GroupAdminPermissionsFilterField,
  GetGroupAdminPermissionsResponseField,
  GroupAdminPermissionsMemberField,
  GroupAdminPermissionsExtField,
  GroupAdminPermissionsField,
  GroupAdminPermissionItemField,
  GroupAdminKickLimitField,
  GetGroupAdminReceiveVerifyRequestField,
  GroupAdminReceiveVerifyFilterField,
  GroupAdminReceiveVerifyIdentityField,
  GetGroupAdminReceiveVerifyResponseField,
  GroupAdminReceiveVerifyMemberField,
  SetGroupAdminReceiveVerifyRequestField,
  GroupAdminReceiveVerifyOperationField,
  SetGroupAdminReceiveVerifyResponseField,
  GroupAdminReceiveVerifyResultField,
  SetGroupAdminPermissionsRequestField,
  GetAdminPermissions,
  SetAdminPermissions,
  GetAdminReceiveVerify,
  SetAdminReceiveVerify,
  encodeGroupAdminPermissionsFilter,
  encodeGetGroupAdminPermissionsRequest,
  encodeSetGroupAdminPermissionsRequest,
  encodeGroupAdminReceiveVerifyFilter,
  encodeGroupAdminReceiveVerifyIdentity,
  encodeGetGroupAdminReceiveVerifyRequest,
  encodeSetGroupAdminReceiveVerifyRequest,
  encodeGroupAdminReceiveVerifyOperation,
  encodeGroupAdminKickLimit,
  decodeGroupAdminPermissionItem,
  decodeGroupAdminPermissions,
  decodeGroupAdminPermissionsExt,
  decodeGroupAdminPermissionsMember,
  decodeGetGroupAdminPermissionsResponse,
  decodeGroupAdminKickLimit,
  decodeGroupAdminReceiveVerifyIdentity,
  decodeGroupAdminReceiveVerifyMember,
  decodeGetGroupAdminReceiveVerifyResponse,
  decodeGroupAdminReceiveVerifyResult,
  decodeSetGroupAdminReceiveVerifyResponse,
  adminPermissionsSnapshot,
  receiveVerifyEnabled,
  confirmSetAdminReceiveVerify,
  setAdminPermissionsSerialize,
} from "./0x9164.js";
export type {
  GetAdminPermissionsParams,
  SetAdminPermissionsParams,
  GetAdminReceiveVerifyParams,
  SetAdminReceiveVerifyParams,
  AdminPermissionsSnapshot,
  GroupAdminKickLimit,
  GroupAdminPermissionsFilter,
  GetGroupAdminPermissionsRequest,
  GroupAdminPermissionItem,
  GroupAdminPermissions,
  GroupAdminPermissionsExt,
  GroupAdminPermissionsMember,
  GetGroupAdminPermissionsResponse,
  SetGroupAdminPermissionsRequest,
  GroupAdminReceiveVerifyFilter,
  GroupAdminReceiveVerifyIdentity,
  GetGroupAdminReceiveVerifyRequest,
  GroupAdminReceiveVerifyMember,
  GetGroupAdminReceiveVerifyResponse,
  GroupAdminReceiveVerifyOperation,
  SetGroupAdminReceiveVerifyRequest,
  GroupAdminReceiveVerifyResult,
  SetGroupAdminReceiveVerifyResponse,
} from "./0x9164.js";

export {
  GROUP_REMARK_COMMAND,
  GROUP_REMARK_SUB_COMMAND,
  Oidb0xf16ReqField,
  Oidb0xf16InnerField,
  SetGroupRemark,
  encodeOidb0xf16Inner,
  encodeOidb0xf16Req,
  decodeGroupRemarkResp,
} from "./0xf16.js";
export type {
  SetGroupRemarkParams,
  Oidb0xf16Inner,
  Oidb0xf16Req,
  GroupRemarkResp,
} from "./0xf16.js";

export {
  GROUP_MEMBER_COMMAND,
  SET_MEMBER_CARD_SUB_COMMAND,
  SET_SPECIAL_TITLE_SUB_COMMAND,
  SPECIAL_TITLE_NEVER_EXPIRES,
  OidbRenameMemberField,
  OidbSpecialTitleField,
  OidbRenameMemberBodyField,
  OidbSpecialTitleBodyField,
  SetMemberCard,
  SetSpecialTitle,
  encodeOidbRenameMemberBody,
  encodeOidbRenameMember,
  encodeOidbSpecialTitleBody,
  encodeOidbSpecialTitle,
  decodeSetMemberCardResp,
  decodeSetSpecialTitleResp,
  setMemberCardParams,
  setSpecialTitleParams,
} from "./0x8fc.js";
export type {
  SetMemberCardParams,
  SetSpecialTitleParams,
  OidbRenameMemberBody,
  OidbRenameMember,
  OidbSpecialTitleBody,
  OidbSpecialTitle,
  SetMemberCardResp,
  SetSpecialTitleResp,
} from "./0x8fc.js";

export {
  FETCH_GROUP_EXT_INFO_COMMAND,
  MODIFY_GROUP_EXT_INFO_COMMAND,
  FETCH_GROUP_EXT_INFO_SUB_COMMAND,
  MODIFY_GROUP_EXT_INFO_SUB_COMMAND,
  OidbGroupExtBodyField,
  OidbGetGroupExtReqField,
  OidbGroupExtFilterField,
  OidbGetGroupExtRespField,
  OidbGetGroupExtItemField,
  OidbModifyGroupExtReqField,
  OidbGroupExtInfoField,
  OidbModifyGroupExtRespField,
  FetchGroupExtInfo,
  ModifyGroupExtInfo,
  encodeOidbGroupExtFilter,
  encodeOidbGetGroupExtReq,
  encodeOidbGroupExtBodyWrite,
  encodeOidbGroupExtInfo,
  encodeOidbModifyGroupExtReq,
  decodeOidbGroupExtBody,
  decodeOidbGetGroupExtItem,
  decodeOidbGetGroupExtResp,
  decodeOidbModifyGroupExtResp,
  toGroupRobotAddOption,
  modifyGroupExtInfoSerialize,
} from "./0xef0.js";
export type {
  FetchGroupExtInfoParams,
  ModifyGroupExtInfoParams,
  GroupRobotAddOption,
  OidbGroupExtFilter,
  OidbGetGroupExtReq,
  OidbGroupExtBody,
  OidbGetGroupExtItem,
  OidbGetGroupExtResp,
  OidbGroupExtBodyWrite,
  OidbGroupExtInfo,
  OidbModifyGroupExtReq,
  OidbModifyGroupExtResp,
} from "./0xef0.js";

export {
  GET_GROUP_CATEGORY_TAGS_COMMAND,
  ADD_GROUP_CATEGORY_TAG_COMMAND,
  DELETE_GROUP_CATEGORY_TAG_COMMAND,
  GROUP_CATEGORY_TAG_SUB_COMMAND,
  GROUP_CLASS_MAX,
  OidbGetGroupCategoryTagsField,
  OidbChangeGroupCategoryTagField,
  OidbGetGroupCategoryTagsRespField,
  OidbGroupCategoryTagField,
  GetGroupCategoryTags,
  AddGroupCategoryTag,
  DeleteGroupCategoryTag,
  assertGroupClass,
  assertTagChange,
  toTag,
  encodeOidbGetGroupCategoryTags,
  encodeOidbChangeGroupCategoryTag,
  decodeOidbGroupCategoryTag,
  decodeOidbGetGroupCategoryTagsResp,
  decodeGroupCategoryTagChangeResp,
} from "./0x967c-967e.js";
export type {
  GroupCategoryTagsParams,
  GroupCategoryTagList,
  GroupCategoryTagChangeParams,
  OidbGetGroupCategoryTags,
  OidbChangeGroupCategoryTag,
  OidbGetGroupCategoryTagsResp,
  OidbGroupCategoryTag,
  GroupCategoryTagChangeResp,
} from "./0x967c-967e.js";

// ---------------------------------------------------------------------------
// Re-exports under the batch brief's names for specs already implemented
// ---------------------------------------------------------------------------
//
// Eleven of the 23 labels are commands that already existed. Re-exporting them
// under their brief names (that text is what `src/bridge/apis/group-admin.ts`
// calls) keeps one codec per command instead of a near-copy.
//
//   0x1097_1  LeaveGroup                     -> batch A's SetGroupLeave
//   0x1096_1  SetAdmin                       -> batch A's SetGroupAdmin
//   0x89a_0   MuteAll                        -> SetGroupWholeBan
//   0x89a_0   SetAddOption                   -> SetGroupAddOption
//   0x89a_0   SetMemberInvitePolicy          -> SetGroupMemberInvitePolicy
//   0x89a_0   SetNewMemberHistoryVisibility  -> SetGroupNewMemberHistoryVisibility
//   0x89a_0   SetMemberPermission            -> SetGroupMemberPermissions
//   0x89a_0   SetSearch                      -> SetGroupSearch
//   0x89a_0   SetGroupName                   -> (not in this batch; kept for symmetry)
export {
  SetGroupLeave as LeaveGroup,
  SetGroupAdmin as SetAdmin,
} from "./0x1096-1097.js";
export {
  SetGroupWholeBan as MuteAll,
  SetGroupAddOption as SetAddOption,
  SetGroupSearch as SetSearch,
  SetGroupMemberInvitePolicy as SetMemberInvitePolicy,
  SetGroupNewMemberHistoryVisibility as SetNewMemberHistoryVisibility,
  SetGroupMemberPermissions as SetMemberPermission,
} from "./0x89a-0.js";

// Batch D: 45 classes over 8 families, closing the last of the 92 commands.
//
// Two of these are deliberately NOT OidbSpec implementations and are exported for their codecs
// only: GetUnidirectionalFriendList never sends an OIDB envelope at all (it calls sendRawPacket
// with a bare body), so wrapping it in invokeOidb would emit a frame the server does not accept.
export {
  UNIDIRECTIONAL_FRIEND_WIRE_NAME,
  buildUnidirectionalFriendRequest,
  decodeOidb0xe17Resp,
  encodeOidb0xe17Req,
  toUnidirectionalFriends,
} from "./0x902e-profile.js";
export type { Oidb0xe17Req, Oidb0xe17Resp, UnidirectionalFriendBlock } from "./0x902e-profile.js";

// `AddCustomFace` — three codecs for a NON-OIDB flow, exported beside the `0x902e` ones
// because they belong to the same feature. Nothing here is an `OidbSpec`: the service is
// `ImgStore.BDHExpressionRoam` (a bare `sendRawPacket`) and the upload is a highway frame
// with `commandId: 9`, the fourth cmdId namespace. See `0x902e-profile.ts`.
export {
  BDH_EXPRESSION_ROAM_SERVICE,
  CUSTOM_FACE_HIGHWAY_COMMAND,
  CUSTOM_FACE_HIGHWAY_COMMAND_ID,
  buildBDHExpressionRoamReq,
  buildFavEmojiHighwayHead,
  customFaceHighwayPath,
  decodeBDHExpressionRoamResp,
  decodeBDHExpressionRoamRespInner,
  encodeBDHExpressionRoamReq,
  encodeFavEmojiHighwayHead,
  makeCustomFaceEmojiId,
} from "./0x902e-profile.js";
export type {
  BDHExpressionRoamInner,
  BDHExpressionRoamReq,
  BDHExpressionRoamResp,
  BDHExpressionRoamRespInner,
  BDHExpressionRoamTail,
  FavEmojiHighwayBaseHead,
  FavEmojiHighwayHead,
  FavEmojiHighwaySegHead,
} from "./0x902e-profile.js";
export { SendPoke, SetEssence, SetReaction, GetEmojiLikes, FetchReactionSummary } from "./0x9082-9084.js";
export type {
  SendPokeParams,
  SetEssenceParams,
  SetReactionParams,
  GetEmojiLikesParams,
  FetchReactionSummaryParams,
  EmojiLikesPage,
  ReactionTally,
} from "./0x9082-9084.js";
export { GetDoubtBuddyReq, RejectDoubtBuddyReq, ApproveDoubtBuddyReq, HandleFriendRequest } from "./0xd69-d72.js";
export type {
  GetDoubtBuddyReqParams,
  RejectDoubtBuddyReqParams,
  ApproveDoubtBuddyReqParams,
  HandleFriendRequestParams,
  DoubtRequest,
} from "./0xd69-d72.js";
export { SendGroupSign, TranslateEnToZh, RequestDbKey, ImageOcr, requestDbKeyResult } from "./0xeb7-cde.js";
export type {
  SendGroupSignParams,
  TranslateEnToZhParams,
  RequestDbKeyParams,
  ImageOcrParams,
} from "./0xeb7-cde.js";
export { FetchRobotUinRanges, GetGroupShareLink, FetchGroupRequestsByUid, SendTuwenArk, FetchDownloadRkeys, toDownloadRkeys } from "./0x496-9067.js";
export type {
  DownloadRkey,
  SendTuwenArkParams,
} from "./0x496-9067.js";
export { GetPrivateFileUrl, UploadPrivateFileRequest, FinalizeOfflineFile, GetPrivatePttUrl, GetPrivateVideoUrl, GetGroupVideoUrl } from "./0x3639-offline.js";
export { ApplyFileset, CommitFile, SetFilesetStatus, ListFilesets, GetFilesetDetail, GetDownloadUrl, SendFlashMsg, CompleteFileset, DeleteFlashFile, RenameFlashFile, PrepareUpload, ApplyUpload } from "./0x93d0-flash.js";
export { FetchAiVoice, FetchAiVoiceList, GroupTodo, GetGroupTodoList } from "./0x929b-extras.js";
export type {
  GroupTodoEntry,
  OidbAiVoiceIndexNode,
  OidbAiVoiceListCategory,
} from "./0x929b-extras.js";
export { MoveCustomFace, FetchCustomFaceDetail, ModifyCustomFace, OrderCustomFace, SetInputStatus } from "./0x902e-profile.js";

// Batch E (4.6): the system-face catalog and single-face lookup.
//
// Both are real OIDB commands with an `OidbBase` envelope — NOT the `0x0e17_0`
// bare-body shape. `0x9154_1`'s body is `10 07` (only field2 is non-zero); `0x9155_1`'s
// body is the `qSid` string at field 1. See `0x9154-9155.ts` for the field tables,
// including why `OidbFaceEmoji`'s width/height are fields 13/14 rather than 11/12.
export { FetchSysFaces, FetchSysFace, emojiToEntry, emojisToEntries } from "./0x9154-9155.js";
export type { CatalogFaceEntry, CatalogPack, FaceEmoji, FaceEmojiList, FaceContent } from "./0x9154-9155.js";
