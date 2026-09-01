(() => {
  const DB_NAME = "upm-shs-fieldwork";
  const DB_VERSION = 2;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = event => {
        const db = req.result;
        const tx = event.target.transaction;

        if (!db.objectStoreNames.contains("submissions")) {
          const store = db.createObjectStore("submissions", { keyPath: "local_uuid" });
          store.createIndex("sync_status", "sync_status", { unique: false });
          store.createIndex("form_code", "form_code", { unique: false });
          store.createIndex("updated_at", "updated_at", { unique: false });
        }

        if (!db.objectStoreNames.contains("media")) {
          const media = db.createObjectStore("media", { keyPath: "local_media_id" });
          media.createIndex("local_uuid", "local_uuid", { unique: false });
        } else {
          const media = tx.objectStore("media");
          if (!media.indexNames.contains("local_uuid")) {
            media.createIndex("local_uuid", "local_uuid", { unique: false });
          }
        }

        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains("templates")) {
          const templates = db.createObjectStore("templates", { keyPath: "version_id" });
          templates.createIndex("form_id", "form_id", { unique: false });
          templates.createIndex("form_code", "form_code", { unique: false });
          templates.createIndex("cached_at", "cached_at", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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

  async function getMediaForSubmission(local_uuid) {
    const db = await openDB();
    const tx = db.transaction("media", "readonly");
    const store = tx.objectStore("media");
    if (store.indexNames.contains("local_uuid")) {
      return requestPromise(store.index("local_uuid").getAll(local_uuid));
    }
    const rows = await requestPromise(store.getAll());
    return (rows || []).filter(row => row.local_uuid === local_uuid);
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

  async function putTemplate(record) {
    const row = { ...record, cached_at: new Date().toISOString() };
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("templates", "readwrite");
      tx.objectStore("templates").put(row);
      tx.oncomplete = () => resolve(row);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getTemplate(version_id) {
    const db = await openDB();
    const tx = db.transaction("templates", "readonly");
    return requestPromise(tx.objectStore("templates").get(version_id));
  }

  async function getAllTemplates() {
    const db = await openDB();
    const tx = db.transaction("templates", "readonly");
    return (await requestPromise(tx.objectStore("templates").getAll())) || [];
  }

  async function deleteTemplate(version_id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("templates", "readwrite");
      tx.objectStore("templates").delete(version_id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  window.ToolkitOfflineDB = {
    openDB, putSubmission, getSubmission, getAllSubmissions,
    putMedia, getMedia, getMediaForSubmission, deleteMedia,
    setSetting, getSetting, putTemplate, getTemplate, getAllTemplates, deleteTemplate
  };
})();
