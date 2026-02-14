const DB_NAME = "fire-demo";
const DB_VERSION = 1;
const STORE_NAME = "kv";

type KVRecord = {
	id: string;
	value: unknown;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
	});
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
		transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
	});
}

async function openDatabase(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "id" });
				}
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
		});
	}
	return dbPromise;
}

export async function readKV<T>(id: string): Promise<T | undefined> {
	const db = await openDatabase();
	const tx = db.transaction(STORE_NAME, "readonly");
	const store = tx.objectStore(STORE_NAME);
	const record = await requestToPromise<KVRecord | undefined>(store.get(id));
	await transactionToPromise(tx);
	return record?.value as T | undefined;
}

export async function writeKV<T>(id: string, value: T): Promise<void> {
	const db = await openDatabase();
	const tx = db.transaction(STORE_NAME, "readwrite");
	const store = tx.objectStore(STORE_NAME);
	store.put({ id, value } satisfies KVRecord);
	await transactionToPromise(tx);
}

export async function deleteKV(id: string): Promise<void> {
	const db = await openDatabase();
	const tx = db.transaction(STORE_NAME, "readwrite");
	const store = tx.objectStore(STORE_NAME);
	store.delete(id);
	await transactionToPromise(tx);
}
