const pool = require('../src/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO coexistence.categories (id, name, description)
      VALUES ('cat-test', 'Test Category', 'For E2E tests')
      ON CONFLICT (id) DO NOTHING
    `);

    const tags = [
      { id: 'tag-hot', name: 'Hot Lead', color: '#dc2626', category_id: 'cat-test' },
      { id: 'tag-vip', name: 'VIP', color: '#7c3aed', category_id: 'cat-test' },
      { id: 'tag-cold', name: 'Cold Outreach', color: '#2563eb', category_id: 'cat-test' },
      { id: 'tag-first', name: 'First Message', color: '#059669', category_id: 'cat-test' },
    ];
    for (const t of tags) {
      await client.query(`
        INSERT INTO coexistence.tags (id, name, color, category_id)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color
      `, [t.id, t.name, t.color, t.category_id]);
    }
    console.log('[seed] Tags seeded');

    const members = [
      { id: 'tm-1', name: 'Rahul Sharma', phone: '+91 98765 43210', bda_id: 'BDA001', address: 'Chennai', email: 'rahul@example.com' },
      { id: 'tm-2', name: 'Priya Iyer', phone: '+91 98765 43211', bda_id: 'BDA002', address: 'Bangalore', email: 'priya@example.com' },
      { id: 'tm-3', name: 'Arun Kumar', phone: '+91 98765 43212', bda_id: 'BDA003', address: 'Chennai', email: 'arun@example.com' },
    ];
    for (const m of members) {
      await client.query(`
        INSERT INTO coexistence.team_members (id, name, phone_number, bda_id, address, email)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, phone_number=EXCLUDED.phone_number
      `, [m.id, m.name, m.phone, m.bda_id, m.address, m.email]);
    }
    console.log('[seed] Team members seeded');

    const fields = [
      { id: 'cf-city', name: 'city', field_type: 'text', sort_order: 1 },
      { id: 'cf-budget', name: 'budget', field_type: 'number', sort_order: 2 },
      { id: 'cf-timeline', name: 'timeline', field_type: 'text', sort_order: 3 },
      { id: 'cf-bhk', name: 'bhk_type', field_type: 'text', sort_order: 4 },
      { id: 'cf-score', name: 'lead_score', field_type: 'number', sort_order: 5 },
      { id: 'cf-source', name: 'source', field_type: 'text', sort_order: 6 },
    ];
    for (const f of fields) {
      await client.query(`
        INSERT INTO coexistence.contact_field_definitions (id, name, field_type, sort_order)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, field_type=EXCLUDED.field_type
      `, [f.id, f.name, f.field_type, f.sort_order]);
    }
    console.log('[seed] Contact fields seeded');

    await client.query(`DELETE FROM coexistence.message_templates WHERE id BETWEEN 101 AND 105`);

    const tpls = [
      [101, 'welcome_message', 'UTILITY', 'en', 'NONE', null, 'Hi {{1}}, welcome to Forge Realty! How can we help you today?', 'Reply STOP to opt out', '[{"type":"QUICK_REPLY","text":"Pricing"},{"type":"QUICK_REPLY","text":"Site Visit"}]', '{"1":"Anjali"}', 'APPROVED'],
      [102, 'property_alert', 'MARKETING', 'en', 'TEXT', 'New Property Alert', 'Hi {{1}}, we found a {{2}} in {{3}} within your budget of {{4}}. Interested?', null, '[{"type":"QUICK_REPLY","text":"Yes"},{"type":"QUICK_REPLY","text":"No"}]', '{"1":"Anjali","2":"2BHK","3":"Anna Nagar","4":"₹1.2 Cr"}', 'APPROVED'],
      [103, 'otp_verify', 'AUTHENTICATION', 'en', 'NONE', null, 'Your Forge Realty verification code is {{1}}. Valid for 10 minutes.', null, '[{"type":"OTP","text":"Copy Code","otpType":"COPY_CODE"}]', '{"1":"123456"}', 'APPROVED'],
      [104, 'follow_up', 'UTILITY', 'en', 'NONE', null, 'Hi {{1}}, just following up on your interest in {{2}}. Would you like to schedule a site visit?', null, '[{"type":"QUICK_REPLY","text":"Book Now"},{"type":"QUICK_REPLY","text":"Not Now"},{"type":"QUICK_REPLY","text":"Call Me"}]', '{"1":"Anjali","2":"3BHK Adyar"}', 'APPROVED'],
      [105, 'brochure_send', 'UTILITY', 'en', 'NONE', null, 'Here is the brochure for {{1}}. Let us know if you have any questions!', null, '[{"type":"URL","text":"View Brochure","value":"https://example.com/brochure.pdf"}]', '{"1":"Anna Nagar 2BHK"}', 'APPROVED'],
    ];
    for (const t of tpls) {
      await client.query(`
        INSERT INTO coexistence.message_templates
        (id, name, category, language, header_type, header_text, body, footer, buttons, samples, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, t);
    }
    console.log('[seed] Templates seeded');

    await client.query(`DELETE FROM coexistence.chatbots WHERE name IN ('Welcome Sub-Flow', 'Pricing Sub-Flow')`);

    const bots = [
      ['Welcome Sub-Flow', 'Sends welcome message and tags contact', 'active', 'keyword', '{"nodes":[{"id":"n1","type":"trigger","x":80,"y":60,"title":"Trigger: START","sub":"When user sends START","triggerKind":"keyword","keyword":"START","matchType":"exact"},{"id":"n2","type":"message","x":80,"y":240,"title":"Welcome","sub":"Send welcome template","templateId":101}],"edges":[{"from":"n1","to":"n2"}]}'],
      ['Pricing Sub-Flow', 'Handles pricing enquiries', 'active', 'keyword', '{"nodes":[{"id":"n1","type":"trigger","x":80,"y":60,"title":"Trigger: PRICE","sub":"When user sends PRICE","triggerKind":"keyword","keyword":"PRICE","matchType":"exact"},{"id":"n2","type":"message","x":80,"y":240,"title":"Pricing Info","sub":"Send pricing template","templateId":102}],"edges":[{"from":"n1","to":"n2"}]}'],
    ];
    for (const b of bots) {
      await client.query(`
        INSERT INTO coexistence.chatbots (name, description, status, trigger_type, config)
        VALUES ($1,$2,$3,$4,$5)
      `, b);
    }
    console.log('[seed] Automations seeded');

    await client.query('COMMIT');
    console.log('[seed] All test data seeded successfully');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[seed] Error:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
