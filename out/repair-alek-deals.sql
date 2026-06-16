BEGIN;
-- Repair Alek ForgeChat deals after duplicate contact cleanup.
-- Canonical deal id=2, duplicate/fake-WA deal id=3.

UPDATE coexistence.deals canonical
SET notes = concat_ws(E'\n\n',
      nullif(canonical.notes,''),
      '[Hermes repair 2026-06-02] Canonical Alek IA360 deal. Stage corrected to Reunión agendada because chat history contains Calendar/Zoom confirmation. Duplicate/fake-WA deal id=3 was closed as lost/internal duplicate.'
    ),
    stage_id = 13,
    status = 'open',
    contact_wa_number = '5213321594582',
    contact_number = '5213322638033',
    contact_name = 'Soy Alek',
    updated_at = now()
WHERE canonical.id = 2;

UPDATE coexistence.deals dup
SET notes = concat_ws(E'\n\n',
      nullif(dup.notes,''),
      '[Hermes repair 2026-06-02] Closed as internal duplicate/fake-WA residue after Alek contact dedupe. Canonical deal is id=2. Do not use wa_number 5210000000000.'
    ),
    stage_id = 16,
    status = 'lost',
    lost_at = coalesce(lost_at, now()),
    updated_at = now()
WHERE dup.id = 3 AND dup.contact_wa_number = '5210000000000';

SELECT d.id||'|'||coalesce(d.title,'')||'|'||coalesce(d.contact_number,'')||'|'||coalesce(d.contact_wa_number,'')||'|'||coalesce(ps.name,'')||'|'||coalesce(d.status,'')
FROM coexistence.deals d
LEFT JOIN coexistence.pipeline_stages ps ON ps.id=d.stage_id
WHERE d.contact_number='5213322638033' OR d.contact_wa_number IN ('5213321594582','5210000000000')
ORDER BY d.id;
COMMIT;
