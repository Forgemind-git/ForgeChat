-- 047: Canonicalize stored media MIME types to the WhatsApp Cloud API's accepted
-- tokens. Browser/OS uploads recorded aliases (image/jpg, audio/x-m4a, …) and
-- values with codec parameters (audio/webm;codecs=opus), which Meta rejects on
-- chat send and template submission. This normalizes existing rows so they match
-- what the app now stores (see backend/src/util/metaMime.js). String-level only —
-- it does not re-sniff file bytes.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['coexistence.media_library', 'coexistence.media_objects'] LOOP
    EXECUTE format($f$
      UPDATE %s
         SET mime_type = CASE lower(split_part(mime_type, ';', 1))
           WHEN 'image/jpg'        THEN 'image/jpeg'
           WHEN 'image/pjpeg'      THEN 'image/jpeg'
           WHEN 'image/x-png'      THEN 'image/png'
           WHEN 'audio/mp3'        THEN 'audio/mpeg'
           WHEN 'audio/mpeg3'      THEN 'audio/mpeg'
           WHEN 'audio/x-mpeg'     THEN 'audio/mpeg'
           WHEN 'audio/x-m4a'      THEN 'audio/mp4'
           WHEN 'audio/m4a'        THEN 'audio/mp4'
           WHEN 'audio/x-aac'      THEN 'audio/aac'
           WHEN 'audio/aacp'       THEN 'audio/aac'
           WHEN 'video/3gpp'       THEN 'video/3gp'
           WHEN 'application/x-pdf' THEN 'application/pdf'
           ELSE lower(split_part(mime_type, ';', 1))
         END
       WHERE mime_type IS NOT NULL
    $f$, tbl);
  END LOOP;
END $$;
