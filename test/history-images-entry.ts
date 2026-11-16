// 项③历史生成图回归入口：导出/导入转换 + ZIP 读写（纯数据层，内存测试）。
export { toSessionFile, toIndexEntry } from '../official-demo/src/services/chat/history/toArchive.js'
export { toLocalSession } from '../official-demo/src/services/chat/history/toLocal.js'
export { checkManifest, readSessionFile, readSessionIndex } from '../official-demo/src/services/chat/history/schema.js'
export { writeArchive } from '../official-demo/src/services/chat/history/zipWriter.js'
export { isZipFile, readArchive, readEntry } from '../official-demo/src/services/chat/history/zipReader.js'
export { MANIFEST_PATH, INDEX_PATH, GENERATED_PATH, imagePath, sessionPath, parseSessionPath } from '../official-demo/src/services/chat/history/paths.js'
export { EXPORT_FORMAT_VERSION } from '../official-demo/src/services/chat/history/format.js'