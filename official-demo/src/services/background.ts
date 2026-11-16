// 自定义背景图：原件存 IndexedDB，设置只存引用 id 与效果参数。
import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'dsh-web-chat-bg'
const STORE = 'background'

let dbPromise: Promise<IDBPDatabase> | null = null
const db = () => {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE)
      }
    },
  })
  return dbPromise
}

/** 保存背景图，返回存储 id */
export const saveBackgroundImage = async (file: Blob): Promise<string> => {
  const id = 'bg-' + crypto.randomUUID()
  const database = await db()
  await database.put(STORE, file, id)
  return id
}

/** 读取背景图 object URL（调用方负责 revoke） */
export const getBackgroundUrl = async (id: string): Promise<string | null> => {
  try {
    const database = await db()
    const blob = (await database.get(STORE, id)) as Blob | undefined
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}

export const clearBackgroundImage = async (id: string): Promise<void> => {
  try {
    const database = await db()
    await database.delete(STORE, id)
  } catch {
    // 忽略
  }
}