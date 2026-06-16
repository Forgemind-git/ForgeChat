BEGIN;
UPDATE coexistence.contacts
SET tags = COALESCE(tags, '[]'::jsonb) || '["feedback-negativo","requiere-alek","pausar-automatizacion"]'::jsonb,
    custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object(
      'ia360_feedback_negativo', 'true',
      'ia360_feedback_negativo_at', '2026-06-02T15:02:02Z',
      'ia360_feedback_negativo_resumen', 'Alek pidió dejar de hacer pruebas sueltas y validar/simular embudos reales.',
      'ia360_stage_guardrail', 'Requiere Alek'
    ),
    updated_at = now()
WHERE wa_number='5213321594582' AND contact_number='5213322638033';

SELECT id||'|'||coalesce(name,'')||'|'||coalesce(tags::text,'[]')||'|'||coalesce(custom_fields->>'ia360_stage_guardrail','')
FROM coexistence.contacts
WHERE wa_number='5213321594582' AND contact_number='5213322638033';
COMMIT;
