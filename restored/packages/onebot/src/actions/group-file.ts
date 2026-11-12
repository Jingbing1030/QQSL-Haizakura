// ---------------------------------------------------------------------------
// RESTORED FRAGMENT — region "../onebot/src/actions/group-file.ts"
// original bundle lines 10340-10923  (582 lines) of dist/index.mjs
//
// This file was extracted verbatim (minus the //#region markers) from the
// flattened single-file rolldown bundle. It is NOT a standalone module: the
// bundle hoisted all imports to the top of dist/index.mjs and merged every
// module into one scope, so identifiers here resolve against the WHOLE
// bundle. Kept for navigation / diffing / editing.
// Ground truth for rebuilds:  pnpm run build   (= scripts/merge.mjs)
// ---------------------------------------------------------------------------
// @ts-nocheck
function busidOr102(raw) {
	const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Math.trunc(Number(raw)) : NaN;
	return Number.isInteger(n) && n >= 0 ? n : 102;
}
var actions$8 = [
	groupAction({
		name: "upload_group_file",
		examples: [{
			summary: "上传群文件",
			params: {
				group_id: 20001,
				file: "file:///path/to/report.pdf",
				name: "报告.pdf"
			},
			notes: "示例路径位于 SnowLuma 服务端，须替换为该服务可读取的实际文件。"
		}],
		returnsSchema: {
			type: "object",
			properties: { file_id: { type: "string" } },
			required: ["file_id"]
		},
		summary: "上传群文件",
		returns: "{ file_id: string }",
		params: {
			file: f$1.file(),
			name: f$1.string().default(""),
			folder: f$1.string().default(""),
			folder_id: f$1.string().default(""),
			upload_file: f$1.bool().default(true)
		},
		run: async (p, ctx) => {
			const folderId = p.folder || p.folder_id || "/";
			return okResponse({ file_id: (await ctx.bridge.apis.groupFile.upload(p.group_id, p.file, p.name, folderId, p.upload_file)).fileId });
		}
	}),
	defineAction({
		name: "upload_private_file",
		examples: [{
			summary: "上传私聊文件",
			params: {
				user_id: 10001,
				file: "file:///path/to/report.pdf",
				name: "报告.pdf"
			},
			notes: "示例路径位于 SnowLuma 服务端，须替换为该服务可读取的实际文件。 默认上传并发送给该好友。"
		}],
		returnsSchema: {
			type: "object",
			properties: { file_id: { type: "string" } },
			required: ["file_id"]
		},
		summary: "上传私聊文件",
		returns: "{ file_id: string }",
		params: {
			user_id: f$1.userId(),
			file: f$1.file(),
			name: f$1.string().default(""),
			upload_file: f$1.bool().default(true)
		},
		run: async (p, ctx) => {
			const result = await ctx.bridge.apis.groupFile.uploadPrivate(p.user_id, p.file, p.name, p.upload_file, false);
			if (p.upload_file) {
				if (!result.fileId) throw new Error("private file upload returned no file_id");
				const uploaded = ctx.bridge.recallUploadedFile(result.fileId);
				if (!uploaded || uploaded.scope !== "private" || uploaded.userId !== p.user_id) throw new Error(`private file upload metadata missing for file_id ${result.fileId}`);
				await ctx.sendPrivateMessage(p.user_id, [{
					type: "file",
					data: {
						file_id: result.fileId,
						name: uploaded.fileName,
						file_size: uploaded.fileSize,
						md5: Buffer.from(uploaded.fileMd5).toString("hex"),
						file_hash: result.fileHash ?? uploaded.fileHash ?? ""
					}
				}], false);
			}
			return okResponse({ file_id: result.fileId });
		}
	}),
	groupAction({
		name: "get_group_file_url",
		examples: [{
			summary: "获取群文件下载链接",
			params: {
				group_id: 20001,
				file_id: "<file-id-from-get_group_root_files>"
			},
			notes: "将 group_id 替换为当前账号可访问的群号。"
		}],
		summary: "获取群文件下载链接",
		readOnly: true,
		returns: "群文件下载链接。",
		returnsSchema: {
			type: "object",
			properties: { url: {
				type: "string",
				description: "文件下载直链"
			} },
			required: ["url"]
		},
		params: {
			file_id: f$1.fileId(),
			busid: f$1.raw()
		},
		run: async (p, ctx) => {
			return okResponse({ url: await ctx.bridge.apis.groupFile.getUrl(p.group_id, p.file_id, busidOr102(p.busid)) });
		}
	}),
	groupAction({
		name: "get_group_root_files",
		examples: [{
			summary: "获取群根目录文件列表",
			params: { group_id: 20001 },
			notes: "将 group_id 替换为当前账号可访问的群号。"
		}],
		summary: "获取群根目录文件列表",
		readOnly: true,
		returns: "群文件系统信息（文件与文件夹列表）。",
		returnsSchema: {
			type: "object",
			properties: {
				files: {
					type: "array",
					description: "文件列表",
					items: {
						type: "object",
						properties: {
							group_id: {
								type: "integer",
								description: "群号"
							},
							file_id: {
								type: "string",
								description: "文件 ID"
							},
							file_name: {
								type: "string",
								description: "文件名"
							},
							busid: {
								type: "integer",
								description: "业务 ID"
							},
							file_size: {
								type: "integer",
								description: "文件大小（字节）"
							},
							upload_time: {
								type: "integer",
								description: "上传时间戳"
							},
							dead_time: {
								type: "integer",
								description: "过期时间戳"
							},
							modify_time: {
								type: "integer",
								description: "修改时间戳"
							},
							download_times: {
								type: "integer",
								description: "下载次数"
							},
							uploader: {
								type: "integer",
								description: "上传者 QQ 号"
							},
							uploader_name: {
								type: "string",
								description: "上传者昵称"
							}
						}
					}
				},
				folders: {
					type: "array",
					description: "文件夹列表",
					items: {
						type: "object",
						properties: {
							group_id: {
								type: "integer",
								description: "群号"
							},
							folder_id: {
								type: "string",
								description: "文件夹 ID"
							},
							folder_name: {
								type: "string",
								description: "文件夹名"
							},
							create_time: {
								type: "integer",
								description: "创建时间戳"
							},
							creator: {
								type: "integer",
								description: "创建者 QQ 号"
							},
							create_name: {
								type: "string",
								description: "创建者昵称"
							},
							total_file_count: {
								type: "integer",
								description: "文件夹内文件总数"
							},
							last_upload_time: {
								type: "integer",
								description: "最后上传时间戳"
							},
							last_uploader: {
								type: "integer",
								description: "最后上传者 QQ 号"
							},
							last_uploader_name: {
								type: "string",
								description: "最后上传者昵称"
							}
						}
					}
				}
			},
			required: ["files", "folders"]
		},
		run: async (p, ctx) => {
			return okResponse(await ctx.getGroupFiles(p.group_id, "/"));
		}
	}),
	groupAction({
		name: "get_group_files_by_folder",
		examples: [{
			summary: "获取群子目录文件列表",
			params: {
				group_id: 20001,
				folder_id: "<folder-id-from-get_group_root_files>"
			},
			notes: "将 group_id 替换为当前账号可访问的群号。"
		}],
		summary: "获取群子目录文件列表",
		readOnly: true,
		returns: "群文件系统信息（文件与文件夹列表）。",
		returnsSchema: {
			type: "object",
			properties: {
				files: {
					type: "array",
					description: "文件列表",
					items: {
						type: "object",
						properties: {
							group_id: {
								type: "integer",
								description: "群号"
							},
							file_id: {
								type: "string",
								description: "文件 ID"
							},
							file_name: {
								type: "string",
								description: "文件名"
							},
							busid: {
								type: "integer",
								description: "业务 ID"
							},
							file_size: {
								type: "integer",
								description: "文件大小（字节）"
							},
							upload_time: {
								type: "integer",
								description: "上传时间戳"
							},
							dead_time: {
								type: "integer",
								description: "过期时间戳"
							},
							modify_time: {
								type: "integer",
								description: "修改时间戳"
							},
							download_times: {
								type: "integer",
								description: "下载次数"
							},
							uploader: {
								type: "integer",
								description: "上传者 QQ 号"
							},
							uploader_name: {
								type: "string",
								description: "上传者昵称"
							}
						}
					}
				},
				folders: {
					type: "array",
					description: "文件夹列表",
					items: {
						type: "object",
						properties: {
							group_id: {
								type: "integer",
								description: "群号"
							},
							folder_id: {
								type: "string",
								description: "文件夹 ID"
							},
							folder_name: {
								type: "string",
								description: "文件夹名"
							},
							create_time: {
								type: "integer",
								description: "创建时间戳"
							},
							creator: {
								type: "integer",
								description: "创建者 QQ 号"
							},
							create_name: {
								type: "string",
								description: "创建者昵称"
							},
							total_file_count: {
								type: "integer",
								description: "文件夹内文件总数"
							},
							last_upload_time: {
								type: "integer",
								description: "最后上传时间戳"
							},
							last_uploader: {
								type: "integer",
								description: "最后上传者 QQ 号"
							},
							last_uploader_name: {
								type: "string",
								description: "最后上传者昵称"
							}
						}
					}
				}
			},
			required: ["files", "folders"]
		},
		params: {
			folder_id: f$1.string().default(""),
			folder: f$1.string().default("")
		},
		run: async (p, ctx) => {
			const folderId = p.folder_id || p.folder || "/";
			return okResponse(await ctx.getGroupFiles(p.group_id, folderId));
		}
	}),
	groupAction({
		name: "delete_group_file",
		examples: [{
			summary: "删除群文件",
			params: {
				group_id: 20001,
				file_id: "<file-id-from-get_group_root_files>"
			},
			notes: "替换群文件列表中的实际 file_id；需要对应文件操作权限。"
		}],
		returnsSchema: {
			type: "null",
			description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"
		},
		summary: "删除群文件",
		params: { file_id: f$1.fileId() },
		run: async (p, ctx) => {
			await ctx.bridge.apis.groupFile.delete(p.group_id, p.file_id);
			return okResponse();
		}
	}),
	groupAction({
		name: "move_group_file",
		examples: [{
			summary: "移动群文件",
			params: {
				group_id: 20001,
				file_id: "<file-id>",
				parent_directory: "/",
				target_directory: "<target-folder-id>"
			},
			notes: "目录和文件标识均来自该群文件列表。"
		}],
		returnsSchema: {
			type: "null",
			description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"
		},
		summary: "移动群文件",
		params: {
			file_id: f$1.fileId(),
			parent_directory: f$1.string({ allowEmpty: false }),
			target_directory: f$1.string({ allowEmpty: false })
		},
		run: async (p, ctx) => {
			await ctx.bridge.apis.groupFile.move(p.group_id, p.file_id, p.parent_directory, p.target_directory);
			return okResponse();
		}
	}),
	groupAction({
		name: "rename_group_file",
		examples: [{
			summary: "重命名群文件",
			params: {
				group_id: 20001,
				file_id: "<file-id>",
				current_parent_directory: "/",
				new_name: "新文件名.pdf"
			},
			notes: "file_id 来自群文件列表，目录必须是文件当前所在目录。"
		}],
		returnsSchema: {
			type: "object",
			properties: { ok: { const: true } },
			required: ["ok"]
		},
		summary: "重命名群文件",
		params: {
			file_id: f$1.fileId(),
			current_parent_directory: f$1.string().default("/"),
			new_name: f$1.string({ allowEmpty: false })
		},
		run: async (p, ctx) => {
			await ctx.bridge.apis.groupFile.rename(p.group_id, p.file_id, p.current_parent_directory || "/", p.new_name);
			return okResponse({ ok: true });
		}
	}),
	groupAction({
		name: "create_group_file_folder",
		examples: [{
			summary: "创建群文件夹",
			params: {
				group_id: 20001,
				name: "共享资料",
				parent_id: "/"
			},
			notes: "将 group_id 替换为当前账号可访问的群号。"
		}],
		returnsSchema: {
			type: "object",
			properties: {
				result: {
					type: "object",
					properties: {
						retCode: { const: 0 },
						retMsg: { const: "success" }
					},
					required: ["retCode", "retMsg"]
				},
				groupItem: {
					type: "object",
					properties: { folderInfo: {
						type: "object",
						properties: {
							folderId: { type: "string" },
							folderName: { type: "string" },
							folderPath: { type: "string" },
							createTime: { type: "integer" },
							modifyTime: { type: "integer" },
							createUin: { type: "integer" },
							modifyUin: { type: "integer" }
						},
						required: [
							"folderId",
							"folderName",
							"folderPath",
							"createTime",
							"modifyTime",
							"createUin",
							"modifyUin"
						]
					} },
					required: ["folderInfo"]
				}
			},
			required: ["result", "groupItem"]
		},
		summary: "创建群文件夹",
		returns: "{ result: { retCode, retMsg }, groupItem: { folderInfo: { folderId, folderName, folderPath, createTime, modifyTime, createUin, modifyUin } } }",
		params: {
			name: f$1.string({ allowEmpty: false }),
			parent_id: f$1.string().default("/")
		},
		run: async (p, ctx) => {
			return okResponse({
				result: {
					retCode: 0,
					retMsg: "success"
				},
				groupItem: { folderInfo: await ctx.bridge.apis.groupFile.createFolder(p.group_id, p.name, p.parent_id || "/") }
			});
		}
	}),
	groupAction({
		name: "delete_group_file_folder",
		examples: [{
			summary: "删除群文件夹",
			params: {
				group_id: 20001,
				folder_id: "<folder-id-from-get_group_root_files>"
			},
			notes: "会删除指定群文件夹，确认资源后调用。"
		}],
		returnsSchema: {
			type: "null",
			description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"
		},
		summary: "删除群文件夹",
		params: { folder_id: f$1.string({ allowEmpty: false }) },
		run: async (p, ctx) => {
			await ctx.bridge.apis.groupFile.deleteFolder(p.group_id, p.folder_id);
			return okResponse();
		}
	}),
	groupAction({
		name: "rename_group_file_folder",
		examples: [{
			summary: "重命名群文件夹",
			params: {
				group_id: 20001,
				folder_id: "<folder-id>",
				new_folder_name: "课程资料"
			},
			notes: "将 group_id 替换为当前账号可访问的群号。"
		}],
		returnsSchema: {
			type: "null",
			description: "成功时 data 为 null；失败另见响应的 status、retcode 和 wording"
		},
		summary: "重命名群文件夹",
		params: {
			folder_id: f$1.string({ allowEmpty: false }),
			new_folder_name: f$1.string().default(""),
			name: f$1.string().default("")
		},
		run: async (p, ctx) => {
			const newName = p.new_folder_name || p.name;
			if (!newName) return failedResponse(RETCODE.BAD_REQUEST, "group_id, folder_id and new_folder_name are required");
			await ctx.bridge.apis.groupFile.renameFolder(p.group_id, p.folder_id, newName);
			return okResponse();
		}
	}),
	defineAction({
		name: "get_private_file_url",
		examples: [{
			summary: "获取私聊文件下载链接",
			params: {
				user_id: 10001,
				file_id: "<file-id-from-private-message>"
			},
			notes: "使用私聊文件消息段中的 file_id，必要时原样传 file_hash。"
		}],
		summary: "获取私聊文件下载链接",
		readOnly: true,
		returns: "私聊文件下载链接。",
		returnsSchema: {
			type: "object",
			properties: { url: {
				type: "string",
				description: "文件下载直链"
			} },
			required: ["url"]
		},
		params: {
			user_id: f$1.userId().optional(),
			file_id: f$1.fileId(),
			file_hash: f$1.string().default("")
		},
		run: async (p, ctx) => {
			return okResponse({ url: await ctx.bridge.apis.groupFile.getPrivateUrl(p.user_id ?? 0, p.file_id, p.file_hash) });
		}
	})
];
export {};
