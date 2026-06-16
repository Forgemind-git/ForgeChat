BEGIN;
UPDATE coexistence.contacts
SET name = 'Soy Alek',
    profile_name = COALESCE(NULLIF(profile_name,''), 'Soy Alek'),
    custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object(
      'email', 'Ocompudoc@gmail.com',
      'nombre_canonico', 'Soy Alek',
      'rol', 'Owner GeekStudio / IA360',
      'tipo_contacto', 'internal_test_owner',
      'identificado_por_hermes', '2026-06-02'
    ),
    updated_at = now()
WHERE wa_number='5213321594582' AND contact_number='5213322638033';

UPDATE coexistence.contacts
SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object(
      'email', 'Ocompudoc@gmail.com',
      'nombre_canonico', 'Soy Alek',
      'tipo_contacto', 'internal_test_owner'
    ),
    updated_at = now()
WHERE contact_number='5213322638033';

SELECT id || '|' || wa_number || '|' || contact_number || '|' || coalesce(name,'') || '|' || coalesce(profile_name,'') || '|' || coalesce(custom_fields::text,'{}')
FROM coexistence.contacts
WHERE contact_number='5213322638033'
ORDER BY id;
COMMIT;
