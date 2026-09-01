(() => {
  const api = {};
  api.safe = (v = "") => String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");

  api.slugKey = (value = "") => String(value).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

  api.normalizeSchema = schema => ({
    sections: Array.isArray(schema?.sections) ? schema.sections : []
  });

  api.fetchAvailableForms = async (client, db) => {
    if (client && navigator.onLine) {
      const { data, error } = await client.rpc("get_my_available_dynamic_forms");
      if (!error && Array.isArray(data)) {
        for (const row of data) {
          await db.putTemplate({
            version_id: row.version_id, form_id: row.form_id, form_code: row.form_code,
            title: row.title, description: row.description, category: row.category,
            version_number: row.version_number, version_label: row.version_label,
            schema_json: row.schema_json, published_at: row.published_at
          });
        }
        await db.setSetting("dynamic_form_list", data.map(row => row.version_id));
        return data;
      }
      if (error) console.warn("[Dynamic forms]", error.message || error);
    }

    const ids = await db.getSetting("dynamic_form_list");
    const all = await db.getAllTemplates();
    if (!Array.isArray(ids) || !ids.length) return all;
    const order = new Map(ids.map((id, i) => [id, i]));
    return all.filter(row => order.has(row.version_id))
      .sort((a,b) => order.get(a.version_id) - order.get(b.version_id));
  };

  api.fetchVersion = async (client, db, versionId) => {
    const cached = await db.getTemplate(versionId);
    if (cached) return cached;
    if (!client || !navigator.onLine) return null;

    const { data, error } = await client.rpc("get_dynamic_form_version", { p_version_id: versionId });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const cachedRow = {
      version_id: row.version_id, form_id: row.form_id, form_code: row.form_code,
      title: row.title, description: row.description, category: row.category,
      version_number: row.version_number, version_label: row.version_label,
      schema_json: row.schema_json, status: row.status, published_at: row.published_at
    };
    await db.putTemplate(cachedRow);
    return cachedRow;
  };

  const safeFilename = name => String(name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-100) || "file";

  api.syncDynamicRecord = async ({ client, db, record }) => {
    if (!navigator.onLine || !client) return false;
    const { data: sessionData } = await client.auth.getSession();
    const sessionUser = sessionData?.session?.user;
    if (!sessionUser) throw new Error("Your login session expired. Sign in again before syncing.");
    if (!record.dynamic_form_version_id) throw new Error("Dynamic form version is missing.");

    const firstGps = Object.values(record.responses || {}).find(
      value => value && typeof value === "object" &&
        Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude))
    );

    const payload = {
      version_id: record.dynamic_form_version_id,
      form_id: record.dynamic_form_id,
      form_code: record.form_code,
      version_number: record.version_number || null,
      local_uuid: record.local_uuid,
      submitted_by: sessionUser.id,
      community_id: record.community_id || null,
      rotation_id: record.rotation_id || null,
      status: record.form_status === "completed" ? "completed" : "draft",
      response_json: record.responses || {},
      latitude: firstGps?.latitude ?? null,
      longitude: firstGps?.longitude ?? null,
      gps_accuracy_m: firstGps?.accuracy ?? null,
      location_captured_at: firstGps?.captured_at ?? null,
      updated_at: new Date().toISOString()
    };

    const { data: serverRow, error } = await client.from("dynamic_form_submissions")
      .upsert(payload, { onConflict: "local_uuid" })
      .select("id,local_uuid,status,media_json").single();
    if (error) throw error;

    const localMedia = await db.getMediaForSubmission(record.local_uuid);
    const uploaded = Array.isArray(serverRow.media_json) ? [...serverRow.media_json] : [];

    for (const media of localMedia) {
      if (!media?.blob || !media.field_key) continue;
      const fileName = safeFilename(media.file_name || "attachment");
      const path = `${sessionUser.id}/${serverRow.id}/${api.slugKey(media.field_key)}-${fileName}`;
      const body = await media.blob.arrayBuffer();

      const { error: uploadError } = await client.storage.from("field-media").upload(path, body, {
        contentType: media.content_type || "application/octet-stream",
        cacheControl: "3600", upsert: true
      });
      if (uploadError) throw uploadError;

      const item = {
        field_key: media.field_key, path,
        file_name: media.file_name || fileName,
        content_type: media.content_type || "application/octet-stream",
        uploaded_at: new Date().toISOString()
      };
      const existing = uploaded.find(x => x.field_key === media.field_key);
      if (existing) Object.assign(existing, item); else uploaded.push(item);
    }

    if (localMedia.length) {
      const { error: updateError } = await client.from("dynamic_form_submissions")
        .update({ media_json: uploaded, updated_at: new Date().toISOString() })
        .eq("id", serverRow.id);
      if (updateError) throw updateError;
    }

    const synced = {
      ...record, user_id: sessionUser.id, server_id: serverRow.id,
      sync_status: "synced", media_json: uploaded,
      synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      last_error: null
    };
    await db.putSubmission(synced);
    return synced;
  };

  window.ToolkitFormEngine = api;
})();
