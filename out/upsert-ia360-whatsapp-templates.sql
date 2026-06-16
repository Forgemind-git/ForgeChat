BEGIN;
DROP TABLE IF EXISTS ia360_template_upsert;
CREATE TEMP TABLE ia360_template_upsert(
  name text,
  category text,
  language text,
  header_text text,
  body text,
  footer text,
  buttons jsonb
);

INSERT INTO ia360_template_upsert VALUES
('ia360_os_01_apertura_dolor','MARKETING','es_MX','IA360: apertura dolor',$$Hola {{1}}, una pregunta directa: ¿dónde crees que tu empresa pierde más dinero hoy: trabajo manual, datos tarde o seguimiento inconsistente?

La idea no es venderte más software. Es detectar el cuello que sí movería la aguja en 30 días.$$,'IA360 · diagnóstico ligero','[{"type":"QUICK_REPLY","text":"Diagnóstico rápido"},{"type":"QUICK_REPLY","text":"Ver mapa 30-60-90"},{"type":"QUICK_REPLY","text":"No ahora"}]'::jsonb),
('ia360_os_02_segmenta_dolor','MARKETING','es_MX','IA360: segmentar dolor',$$Perfecto. Para priorizar bien, ¿qué síntoma pesa más hoy?$$,'Una respuesta basta','[{"type":"QUICK_REPLY","text":"Captura manual"},{"type":"QUICK_REPLY","text":"Reportes tarde"},{"type":"QUICK_REPLY","text":"Seguimiento ventas"}]'::jsonb),
('ia360_os_03_mecanismo','MARKETING','es_MX','IA360: mecanismo',$$El mecanismo no es poner ChatGPT. Es montar una capa IA360 sobre tu operación: WhatsApp, CRM, ERP, BI y agentes con control humano.

¿Qué ejemplo quieres ver primero?$$,'Humano en control','[{"type":"QUICK_REPLY","text":"WhatsApp → CRM"},{"type":"QUICK_REPLY","text":"ERP → BI"},{"type":"QUICK_REPLY","text":"Agente follow-up"}]'::jsonb),
('ia360_os_04_mapa_30_60_90','MARKETING','es_MX','IA360: mapa 30-60-90',$$Si tu caso tiene sentido, el siguiente paso es un mapa 30-60-90:

• quick wins
• integraciones necesarias
• primer agente o tablero
• riesgos y gobierno
• siguiente acción comercial

¿Quieres aterrizarlo?$$,'Mapa accionable','[{"type":"QUICK_REPLY","text":"Quiero mapa"},{"type":"QUICK_REPLY","text":"Ver ejemplo"},{"type":"QUICK_REPLY","text":"Agendar"}]'::jsonb),
('ia360_os_05_fit_prioridad','MARKETING','es_MX','IA360: fit prioridad',$$Para no saturarte: ¿qué tan prioritario es resolver esto?$$,'Priorización','[{"type":"QUICK_REPLY","text":"Sí, urgente"},{"type":"QUICK_REPLY","text":"Estoy explorando"},{"type":"QUICK_REPLY","text":"No prioritario"}]'::jsonb),
('ia360_os_06_reactivacion','MARKETING','es_MX','IA360: reactivación',$$Te dejo un criterio práctico: si una tarea se repite, depende de WhatsApp/Excel o retrasa decisiones, probablemente hay una oportunidad IA360.

Cuando quieras, lo convertimos en un mapa concreto.$$,'Reactivación suave','[{"type":"QUICK_REPLY","text":"Aplicarlo"},{"type":"QUICK_REPLY","text":"Más adelante"},{"type":"QUICK_REPLY","text":"Baja"}]'::jsonb),
('ia360_os_call_requested','UTILITY','es_MX','IA360: llamada solicitada',$$Quedó marcada tu solicitud de llamada con Alek. Para prepararla bien, necesitamos ubicar objetivo, sistema actual e integración principal.

¿Quieres elegir horario o mandar contexto primero?$$,'Preparación de llamada','[{"type":"QUICK_REPLY","text":"Elegir horario"},{"type":"QUICK_REPLY","text":"Enviar contexto"},{"type":"QUICK_REPLY","text":"Más tarde"}]'::jsonb),
('ia360_os_meeting_confirmed','UTILITY','es_MX','IA360: reunión confirmada',$$Listo, reunión confirmada con Alek.

Hora: {{1}}
Zoom: {{2}}

También quedó en Calendar.$$,'Reunión IA360','[{"type":"QUICK_REPLY","text":"Enviar contexto"},{"type":"QUICK_REPLY","text":"Reagendar"},{"type":"QUICK_REPLY","text":"Cancelar"}]'::jsonb),
('ia360_os_meeting_reminder','UTILITY','es_MX','IA360: recordatorio reunión',$$Recordatorio: tienes reunión con Alek hoy a las {{1}}.

Objetivo: revisar {{2}} y definir siguiente paso IA360.$$,'Recordatorio','[{"type":"QUICK_REPLY","text":"Confirmo"},{"type":"QUICK_REPLY","text":"Reagendar"},{"type":"QUICK_REPLY","text":"Enviar contexto"}]'::jsonb),
('ia360_os_post_meeting_next','UTILITY','es_MX','IA360: post reunión',$$Gracias por la llamada. Con lo revisado, el siguiente paso es aterrizar {{1}}.

¿Quieres que Alek prepare alcance, costo o mapa 30-60-90?$$,'Siguiente paso','[{"type":"QUICK_REPLY","text":"Alcance"},{"type":"QUICK_REPLY","text":"Costo"},{"type":"QUICK_REPLY","text":"Mapa 30-60-90"}]'::jsonb);

UPDATE coexistence.message_templates mt
SET category = u.category,
    language = u.language,
    header_type = 'TEXT',
    header_text = u.header_text,
    body = u.body,
    footer = u.footer,
    buttons = u.buttons,
    status = 'DRAFT',
    allow_category_change = true,
    updated_at = now()
FROM ia360_template_upsert u
WHERE mt.name = u.name;

INSERT INTO coexistence.message_templates
  (name, category, language, header_type, header_text, body, footer, buttons, status, allow_category_change, created_at, updated_at)
SELECT u.name, u.category, u.language, 'TEXT', u.header_text, u.body, u.footer, u.buttons, 'DRAFT', true, now(), now()
FROM ia360_template_upsert u
WHERE NOT EXISTS (
  SELECT 1 FROM coexistence.message_templates mt WHERE mt.name = u.name
);

SELECT name || '|' || status || '|' || category
FROM coexistence.message_templates
WHERE name LIKE 'ia360_os_%'
ORDER BY name;
COMMIT;
