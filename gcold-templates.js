// G-COLD: crea y somete a Meta los 17 templates fríos restantes (QUICK_REPLY)
// vía el flujo /api/templates existente. Corre DENTRO del contenedor backend
// (tiene jsonwebtoken y JWT_SECRET en env). Idempotente: si el nombre ya
// existe, reutiliza la fila; solo somete si el status NO es
// PENDING/APPROVED/SUBMITTED. Cada entrada puede definir samples propios
// (default {1:'Emmanuel'}).
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:3011/api';
const FOOTER = 'Responde STOP si no quieres recibir esto';
const SAMPLES = { 1: 'Emmanuel' };

const TEMPLATES = [
  {
    name: 'ia360_beta_architectura',
    body: 'Hola {{1}}, soy la IA de Alek. Alek está construyendo IA360, un sistema que conecta WhatsApp, CRM y memoria de clientes, y me pidió validarlo con gente de su confianza antes de usarlo con clientes reales. No te quiero vender nada: solo necesito tu ojo técnico. ¿Me dejas hacerte una pregunta corta?',
    buttons: ['Sí, pregúntame', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_beta_feedback',
    body: 'Hola {{1}}, soy la IA de Alek. Alek está probando IA360 (su sistema de WhatsApp + CRM con memoria) con contactos de confianza y quiere críticas directas, no cumplidos. ¿Me dejas hacerte una pregunta breve sobre cómo se siente recibir mensajes de una IA como esta?',
    buttons: ['Sí, pregúntame', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_beta_memoria',
    body: 'Hola {{1}}, soy la IA de Alek. Estoy aprendiendo a recordar el contexto de cada persona sin volverme invasiva, y Alek me pidió probarlo contigo porque te tiene confianza. ¿Me dejas hacerte una pregunta corta para poner a prueba mi memoria?',
    buttons: ['Sí, a ver', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_referido_contexto',
    body: 'Hola {{1}}, soy la IA de Alek. Te escribo porque nos presentó {{2}} y, antes de mandarte cualquier propuesta, Alek quiere entender tu contexto para no escribirte algo fuera de lugar. ¿Cómo prefieres empezar?',
    buttons: ['Hazme una pregunta', 'Que me escriba Alek', 'Ahora no'],
    samples: { 1: 'Emmanuel', 2: 'Carlos' },
  },
  {
    name: 'ia360_referido_oneliner',
    body: 'Hola {{1}}, soy la IA de Alek. Nos presentaron hace poco y Alek prefiere darte la versión corta antes que una llamada a ciegas: IA360 evita que el seguimiento se caiga entre WhatsApp, el CRM, la agenda y la gente. ¿Quieres explorar si aplica a tu caso?',
    buttons: ['Sí, cuéntame más', 'Que me escriba Alek', 'Por ahora no'],
  },
  {
    name: 'ia360_aliado_criterios_fit',
    body: 'Hola {{1}}, soy la IA de Alek. Alek no quiere pedirte intros a ciegas: primero quiere definir contigo qué tipo de empresa sí tiene sentido para IA360. ¿Me dejas preguntarte qué señales ves cuando un cliente ya necesita ordenar su WhatsApp, CRM o seguimiento?',
    buttons: ['Sí, pregúntame', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_aliado_caso_reventa',
    body: 'Hola {{1}}, soy la IA de Alek. Alek preparó un caso NDA-safe de IA360 (el problema, la operación antes y el resultado esperado) para que puedas explicárselo a tus clientes sin exponer datos de nadie. ¿Te lo comparto?',
    buttons: ['Sí, compártelo', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_cliente_readout',
    body: 'Hola {{1}}, soy la IA de Alek. Como ya estamos trabajando juntos, Alek me pidió darle seguimiento a tu proyecto sin esperar a la siguiente reunión. ¿Hay algún avance, fricción o pendiente que quieras que le ponga enfrente hoy?',
    buttons: ['Sí, te cuento', 'Todo va bien', 'Que me escriba Alek'],
  },
  {
    name: 'ia360_cliente_soporte',
    body: 'Hola {{1}}, soy la IA de Alek. Antes de hablar de siguientes pasos en tu proyecto, Alek quiere asegurarse de que nada esté atorado de su lado. ¿Hay alguna fricción concreta que quieras que vea primero?',
    buttons: ['Sí, hay un tema', 'Todo en orden', 'Que me escriba Alek'],
  },
  {
    name: 'ia360_sponsor_fuga_valor',
    body: 'Hola {{1}}, soy la IA de Alek. Cuando IA360 sí aplica, se nota en cuatro fugas: tiempo perdido en tareas manuales, seguimiento que se cae, datos poco confiables y decisiones lentas. ¿Cuál de esas te preocupa más hoy?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_sponsor_caso_ndasafe',
    body: 'Hola {{1}}, soy la IA de Alek. Si prefieres ver evidencia antes de hablar de soluciones, Alek puede compartirte un caso NDA-safe de IA360: el problema, el enfoque y el resultado esperado, sin exponer datos de ningún cliente. ¿Te lo mando?',
    buttons: ['Sí, mándalo', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_comercial_wa_crm',
    body: 'Hola {{1}}, soy la IA de Alek. Muchas fugas comerciales no vienen del vendedor, sino de WhatsApp y el CRM trabajando sin contexto compartido. En tu operación, ¿qué se pierde más hoy: historial de clientes, seguimiento, prioridad de leads o datos para decidir?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_comercial_motor_prospeccion',
    body: 'Hola {{1}}, soy la IA de Alek. Para aplicar IA360 a prospección hacen falta tres piezas: un segmento claro, un mensaje repetible y un seguimiento medible. ¿Qué parte de ese motor está más débil en tu equipo hoy?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_cfo_cartera_datos',
    body: 'Hola {{1}}, soy la IA de Alek. Cuando la cartera o los datos viven dispersos, la decisión financiera llega tarde. ¿Qué información te cuesta más tener confiable y a tiempo?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_cfo_comisiones',
    body: 'Hola {{1}}, soy la IA de Alek. En comisiones y conciliación, el problema suele estar en reglas manuales, excepciones y datos que no cuadran. ¿Dónde se te va más tiempo revisando o corrigiendo?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_tecnico_rollback',
    body: 'Hola {{1}}, soy la IA de Alek. Antes de hablar de funciones, Alek quiere entender qué riesgo técnico habría que controlar primero en una integración con IA360. ¿Cuál revisarías antes que nada: permisos, datos, trazabilidad, reversibilidad o dependencia operativa?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
  {
    name: 'ia360_tecnico_integracion',
    body: 'Hola {{1}}, soy la IA de Alek. Si hacemos una prueba técnica de IA360, Alek la quiere limitada, trazable y reversible. ¿Qué condición tendría que cumplirse para que te parezca segura?',
    buttons: ['Te respondo aquí', 'Que me escriba Alek', 'Ahora no'],
  },
];

async function main() {
  const token = jwt.sign(
    { id: 1, username: 'admin', displayName: 'admin', role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  const headers = { 'content-type': 'application/json', cookie: `forgecrm_token=${token}` };

  const listRes = await fetch(`${BASE}/templates`, { headers });
  const listJson = await listRes.json().catch(() => null);
  const existing = Array.isArray(listJson) ? listJson : (listJson?.templates || listJson?.rows || []);

  for (const t of TEMPLATES) {
    let row = existing.find(x => x.name === t.name);
    if (!row) {
      const createRes = await fetch(`${BASE}/templates`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: t.name,
          category: 'MARKETING',
          language: 'es_MX',
          header_type: 'NONE',
          body: t.body,
          footer: FOOTER,
          buttons: t.buttons.map(text => ({ type: 'QUICK_REPLY', text })),
          samples: t.samples || SAMPLES,
        }),
      });
      const createJson = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        console.log(`CREATE_FAIL ${t.name} ${createRes.status} ${JSON.stringify(createJson)}`);
        continue;
      }
      row = createJson?.template || createJson;
      console.log(`CREATED ${t.name} id=${row?.id} status=${row?.status}`);
    } else {
      console.log(`EXISTS ${t.name} id=${row.id} status=${row.status}`);
    }
    const status = String(row?.status || '').toUpperCase();
    if (!row?.id) continue;
    if (['PENDING', 'APPROVED', 'SUBMITTED'].includes(status)) {
      console.log(`SKIP_SUBMIT ${t.name} (status=${status})`);
      continue;
    }
    const subRes = await fetch(`${BASE}/templates/${row.id}/submit`, { method: 'POST', headers });
    const subJson = await subRes.json().catch(() => null);
    console.log(`SUBMIT ${t.name} http=${subRes.status} -> ${JSON.stringify(subJson).slice(0, 220)}`);
  }
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
