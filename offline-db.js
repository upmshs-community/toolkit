(() => {
  const DB_NAME = "upm-shs-fieldwork";
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("submissions")) {
          const store = db.createObjectStore("submissions", { keyPath: "local_uuid" });
          store.createIndex("sync_status", "sync_status", { unique: false });
          store.createIndex("form_code", "form_code", { unique: false });
          store.createIndex("updated_at", "updated_at", { unique: false });
        }
        if (!db.objectStoreNames.contains("media")) {
          db.createObjectStore("media", { keyPath: "local_media_id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function withStore(storeName, mode, callback) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = callback(store);
      } catch (err) {
        reject(err);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function requestPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putSubmission(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("submissions", "readwrite");
      tx.objectStore("submissions").put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getSubmission(local_uuid) {
    const db = await openDB();
    const tx = db.transaction("submissions", "readonly");
    return requestPromise(tx.objectStore("submissions").get(local_uuid));
  }

  async function getAllSubmissions() {
    const db = await openDB();
    const tx = db.transaction("submissions", "readonly");
    const rows = await requestPromise(tx.objectStore("submissions").getAll());
    return (rows || []).sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }

  async function putMedia(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getMedia(local_media_id) {
    const db = await openDB();
    const tx = db.transaction("media", "readonly");
    return requestPromise(tx.objectStore("media").get(local_media_id));
  }

  async function deleteMedia(local_media_id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("media", "readwrite");
      tx.objectStore("media").delete(local_media_id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function setSetting(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put({ key, value, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getSetting(key) {
    const db = await openDB();
    const tx = db.transaction("settings", "readonly");
    const row = await requestPromise(tx.objectStore("settings").get(key));
    return row?.value ?? null;
  }

  window.ToolkitOfflineDB = {
    openDB,
    putSubmission,
    getSubmission,
    getAllSubmissions,
    putMedia,
    getMedia,
    deleteMedia,
    setSetting,
    getSetting
  };
})();
