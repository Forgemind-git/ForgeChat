BEGIN;
-- Canonical ForgeChat Alek contact: id=2, wa_number=5213321594582, contact_number=5213322638033.
-- Duplicate to remove: id=157, fake wa_number=5210000000000.

UPDATE coexistence.contacts c
SET tags = (
      SELECT jsonb_agg(DISTINCT elem)
      FROM jsonb_array_elements(COALESCE(c.tags,'[]'::jsonb) || COALESCE(d.tags,'[]'::jsonb)) elem
    ),
    custom_fields = COALESCE(c.custom_fields,'{}'::jsonb) || COALESCE(d.custom_fields,'{}'::jsonb) || jsonb_build_object(
      'dedupe_canonical', 'true',
      'dedupe_merged_contact_ids', '157',
      'dedupe_merged_at', '2026-06-02T15:23:00Z',
      'dedupe_reason', 'Same Alek WhatsApp number; remove fake wa_number duplicate.'
    ),
    name = 'Soy Alek',
    profile_name = 'Soy Alek',
    updated_at = now()
FROM coexistence.contacts d
WHERE c.id=2 AND d.id=157;

DELETE FROM coexistence.contacts WHERE id=157;

SELECT id||'|'||wa_number||'|'||contact_number||'|'||coalesce(name,'')||'|'||coalesce(profile_name,'')||'|'||coalesce(custom_fields->>'dedupe_merged_contact_ids','')
FROM coexistence.contacts
WHERE contact_number='5213322638033'
ORDER BY id;
COMMIT;
