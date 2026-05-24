import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, ChevronDown, MoreVertical, X, Loader2, Trash2, Pencil, Search,
  BarChart3, Wallet, Target, TrendingUp, Trophy, XCircle, Check, GripVertical,
} from 'lucide-react';
import { api } from '../api.js';
import { C, FONT, MONO, maskPhone } from '../constants.js';

/* --------------------------------- helpers -------------------------------- */
const fmtMoney = (n, currency = 'INR') => {
  const sym = currency === 'INR' ? '₹' : '';
  return `${sym}${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
};
const COLUMN_W = 300;

/* ============================== main page ================================= */
export default function PipelinesPage({ user }) {
  const isAdmin = user?.role === 'admin';

  const [pipelines, setPipelines] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [deals, setDeals] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dealsLoading, setDealsLoading] = useState(false);

  const [pipeMenuOpen, setPipeMenuOpen] = useState(false);
  const [pipeSelectOpen, setPipeSelectOpen] = useState(false);
  const [dealModal, setDealModal] = useState(null);      // { deal|null, defaultStageId }
  const [pipelineModal, setPipelineModal] = useState(null); // { mode:'create'|'rename' }
  const [stagesModal, setStagesModal] = useState(false);

  const [draggedDeal, setDraggedDeal] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);

  const selected = pipelines.find(p => p.id === selectedId) || null;
  const stages = selected?.stages || [];

  const loadPipelines = useCallback(async (keepId) => {
    setLoading(true);
    try {
      const data = await api.pipelines.list();
      setPipelines(data);
      setSelectedId(prev => {
        const target = keepId ?? prev;
        if (target && data.some(p => p.id === target)) return target;
        const def = data.find(p => p.isDefault) || data[0];
        return def ? def.id : null;
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeals = useCallback(async (pipelineId) => {
    if (!pipelineId) { setDeals([]); setMetrics(null); return; }
    setDealsLoading(true);
    try {
      const [d, m] = await Promise.all([
        api.deals.list(pipelineId),
        api.deals.metrics(pipelineId),
      ]);
      setDeals(d);
      setMetrics(m);
    } catch (err) {
      console.error(err);
    } finally {
      setDealsLoading(false);
    }
  }, []);

  useEffect(() => { loadPipelines(); }, [loadPipelines]);
  useEffect(() => { if (selectedId) loadDeals(selectedId); }, [selectedId, loadDeals]);

  /* ------------------------------- drag/drop ------------------------------ */
  const onDropToStage = async (stageId) => {
    setDragOverStage(null);
    const deal = draggedDeal;
    setDraggedDeal(null);
    if (!deal || deal.stageId === stageId) return;
    // optimistic
    setDeals(prev => prev.map(d => d.id === deal.id ? { ...d, stageId } : d));
    try {
      const updated = await api.deals.move(deal.id, stageId);
      setDeals(prev => prev.map(d => d.id === updated.id ? updated : d));
      loadDeals(selectedId); // refresh metrics (won/lost may have changed)
    } catch (err) {
      alert(err.message || 'Could not move deal');
      loadDeals(selectedId); // revert
    }
  };

  /* --------------------------------- render ------------------------------- */
  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontFamily: FONT }}>Loading…</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: FONT, minHeight: '100%' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0 }}>Pipelines</h1>

        {/* Pipeline selector */}
        {selected && (
          <div style={{ position: 'relative' }}>
            <button onClick={() => setPipeSelectOpen(o => !o)} style={selectBtnStyle}>
              <KanbanGlyph /> {selected.name} <ChevronDown size={15} />
            </button>
            {pipeSelectOpen && (
              <>
                <div style={overlayStyle} onClick={() => setPipeSelectOpen(false)} />
                <div style={{ ...dropdownStyle, minWidth: 220 }}>
                  {pipelines.map(p => (
                    <div key={p.id} onClick={() => { setSelectedId(p.id); setPipeSelectOpen(false); }}
                      style={{ ...dropItemStyle, fontWeight: p.id === selectedId ? 700 : 500 }}>
                      {p.name}{p.isDefault ? ' · default' : ''}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ flex: 1 }} />

        {isAdmin && (
          <>
            <button onClick={() => setPipelineModal({ mode: 'create' })} style={ghostBtnStyle}>
              <Plus size={15} /> Add Pipeline
            </button>
            <button onClick={() => setDealModal({ deal: null, defaultStageId: stages[0]?.id })} style={primaryBtnStyle} disabled={!selected}>
              <Plus size={15} /> Add Deal
            </button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setPipeMenuOpen(o => !o)} style={iconBtnStyle} title="Pipeline options"><MoreVertical size={18} /></button>
              {pipeMenuOpen && (
                <>
                  <div style={overlayStyle} onClick={() => setPipeMenuOpen(false)} />
                  <div style={dropdownStyle}>
                    <div style={dropItemStyle} onClick={() => { setPipeMenuOpen(false); setStagesModal(true); }}>Manage stages</div>
                    <div style={dropItemStyle} onClick={() => { setPipeMenuOpen(false); setPipelineModal({ mode: 'rename' }); }}>Rename pipeline</div>
                    <div style={{ ...dropItemStyle, color: C.primary }} onClick={async () => {
                      setPipeMenuOpen(false);
                      if (!window.confirm(`Delete pipeline "${selected.name}" and ALL its deals? This cannot be undone.`)) return;
                      try { await api.pipelines.delete(selected.id); loadPipelines(); }
                      catch (err) { alert(err.message || 'Delete failed'); }
                    }}>Delete pipeline</div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
        <KpiTile Icon={BarChart3} label="Total Deals" value={metrics?.totalDeals ?? 0} />
        <KpiTile Icon={Wallet} label="Pipeline Value" value={fmtMoney(metrics?.pipelineValue)} />
        <KpiTile Icon={Target} label="Avg Deal Size" value={fmtMoney(metrics?.avgDealSize)} />
        <KpiTile Icon={TrendingUp} label="Weighted Value" value={fmtMoney(metrics?.weightedValue)} />
        <KpiTile Icon={Trophy} label="Won This Month" value={metrics?.wonThisMonth ?? 0} />
        <KpiTile Icon={XCircle} label="Lost This Month" value={metrics?.lostThisMonth ?? 0} />
      </div>

      {/* Kanban */}
      {!selected ? (
        <EmptyState text="No pipeline yet." />
      ) : (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {stages.map(stage => {
            const stageDeals = deals.filter(d => d.stageId === stage.id);
            const total = stageDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);
            const over = dragOverStage === stage.id;
            return (
              <div key={stage.id}
                onDragOver={e => { e.preventDefault(); setDragOverStage(stage.id); }}
                onDragLeave={() => setDragOverStage(s => (s === stage.id ? null : s))}
                onDrop={() => onDropToStage(stage.id)}
                style={{
                  width: COLUMN_W, flexShrink: 0, background: C.cardBg, borderRadius: 12,
                  border: `1px solid ${over ? C.primary : C.border}`,
                  borderTop: `3px solid ${stage.color || C.borderDark}`,
                  display: 'flex', flexDirection: 'column', maxHeight: '70vh',
                }}>
                {/* column header */}
                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{stage.name}</span>
                    <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, background: C.pageBg, borderRadius: 99, padding: '1px 8px' }}>{stageDeals.length}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 600 }}>{fmtMoney(total)}</span>
                    <span style={{ fontSize: 11, color: C.textMuted }}>{stage.probability}%</span>
                  </div>
                </div>

                {/* deals */}
                <div style={{ padding: 10, overflowY: 'auto', flex: 1, minHeight: 90 }}>
                  {stageDeals.length === 0 ? (
                    <div style={{
                      border: `1px dashed ${over ? C.primary : C.border}`, borderRadius: 10,
                      padding: '26px 10px', textAlign: 'center', color: C.textMuted, fontSize: 12,
                    }}>Drop a deal here</div>
                  ) : stageDeals.map(deal => (
                    <DealCard key={deal.id} deal={deal}
                      onDragStart={() => setDraggedDeal(deal)}
                      onClick={() => setDealModal({ deal, defaultStageId: deal.stageId })} />
                  ))}
                </div>

                {/* footer */}
                {isAdmin && (
                  <div style={{ borderTop: `1px solid ${C.border}` }}>
                    <button onClick={() => setDealModal({ deal: null, defaultStageId: stage.id })}
                      style={{ width: '100%', padding: '10px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textSecondary, fontSize: 13, fontWeight: 600, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Plus size={14} /> Add Deal
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {stages.length === 0 && <EmptyState text={isAdmin ? 'This pipeline has no stages. Use "Manage stages" to add some.' : 'This pipeline has no stages yet.'} />}
        </div>
      )}

      {dealsLoading && <div style={{ position: 'fixed', bottom: 16, right: 16, fontSize: 12, color: C.textMuted, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={13} className="spin" /> Updating…</div>}

      {/* Modals */}
      {dealModal && (
        <DealModal
          deal={dealModal.deal}
          defaultStageId={dealModal.defaultStageId}
          pipeline={selected}
          stages={stages}
          isAdmin={isAdmin}
          onClose={() => setDealModal(null)}
          onSaved={() => { setDealModal(null); loadDeals(selectedId); }}
          onDeleted={() => { setDealModal(null); loadDeals(selectedId); }}
        />
      )}
      {pipelineModal && (
        <PipelineModal
          mode={pipelineModal.mode}
          current={pipelineModal.mode === 'rename' ? selected : null}
          onClose={() => setPipelineModal(null)}
          onSaved={(newId) => { setPipelineModal(null); loadPipelines(newId); }}
        />
      )}
      {stagesModal && selected && (
        <StagesModal
          pipeline={selected}
          onClose={() => setStagesModal(false)}
          onChanged={() => loadPipelines(selected.id)}
        />
      )}
    </div>
  );
}

/* ============================== sub-components ============================ */
function KanbanGlyph() {
  return <span style={{ display: 'inline-flex', gap: 2 }}>
    <span style={{ width: 3, height: 12, background: C.primary, borderRadius: 1 }} />
    <span style={{ width: 3, height: 12, background: '#EAB308', borderRadius: 1 }} />
    <span style={{ width: 3, height: 12, background: '#16A34A', borderRadius: 1 }} />
  </span>;
}

function KpiTile({ Icon, label, value }) {
  return (
    <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.textMuted, marginBottom: 6 }}>
        <Icon size={13} />
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.text }}>{value}</div>
    </div>
  );
}

function DealCard({ deal, onDragStart, onClick }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={{
        background: 'var(--c-cardBg, #fff)', border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '10px 12px', marginBottom: 8, cursor: 'pointer', boxShadow: C.shadowSm,
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = C.borderDark}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{deal.title}</span>
        <GripVertical size={14} style={{ color: C.textMuted, flexShrink: 0, opacity: 0.6 }} />
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginTop: 4 }}>{fmtMoney(deal.value, deal.currency)}</div>
      {deal.contactName && (
        <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 4 }}>{deal.contactName}</div>
      )}
      {deal.assignedUserName && (
        <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: C.purple, background: '#EEF', borderRadius: 99, padding: '2px 8px' }}>{deal.assignedUserName}</span>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: C.textMuted, fontSize: 13, width: '100%' }}>{text}</div>
  );
}

/* ------------------------------- DealModal -------------------------------- */
function DealModal({ deal, defaultStageId, pipeline, stages, isAdmin, onClose, onSaved, onDeleted }) {
  const readOnly = !isAdmin;
  const editing = !!deal;
  const [form, setForm] = useState(() => ({
    title: deal?.title || '',
    value: deal?.value ?? '',
    stageId: deal?.stageId || defaultStageId || stages[0]?.id || '',
    assignedUserId: deal?.assignedUserId || '',
    contactWaNumber: deal?.contactWaNumber || '',
    contactNumber: deal?.contactNumber || '',
    contactName: deal?.contactName || '',
    expectedCloseDate: deal?.expectedCloseDate ? String(deal.expectedCloseDate).slice(0, 10) : '',
    notes: deal?.notes || '',
  }));
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [contactOpen, setContactOpen] = useState(false);
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!isAdmin) return;
    api.users.list().then(setUsers).catch(() => setUsers([]));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !contactQuery.trim()) { setContactResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try { setContactResults(await api.deals.contactSearch(contactQuery.trim())); }
      catch { setContactResults([]); }
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [contactQuery, isAdmin]);

  const save = async () => {
    if (!form.title.trim()) { alert('Deal title is required'); return; }
    setSaving(true);
    try {
      const payload = {
        pipelineId: pipeline.id,
        stageId: form.stageId,
        title: form.title.trim(),
        value: Number(form.value) || 0,
        assignedUserId: form.assignedUserId || null,
        contactWaNumber: form.contactWaNumber || null,
        contactNumber: form.contactNumber || null,
        contactName: form.contactName || null,
        expectedCloseDate: form.expectedCloseDate || null,
        notes: form.notes || null,
      };
      if (editing) await api.deals.update(deal.id, payload);
      else await api.deals.create(payload);
      onSaved();
    } catch (err) {
      alert(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete deal "${deal.title}"?`)) return;
    try { await api.deals.delete(deal.id); onDeleted(); }
    catch (err) { alert(err.message || 'Delete failed'); }
  };

  const linkContact = (c) => {
    setForm(f => ({ ...f, contactWaNumber: c.waNumber, contactNumber: c.contactNumber, contactName: c.name || c.contactNumber }));
    setContactOpen(false); setContactQuery(''); setContactResults([]);
  };

  return (
    <ModalShell onClose={onClose} title={readOnly ? 'Deal details' : editing ? 'Edit deal' : 'New deal'} width={520}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field label="Title">
          <input style={inp} value={form.title} disabled={readOnly} autoFocus={!readOnly}
            onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Website revamp for Acme" />
        </Field>
        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Value (₹)" style={{ flex: 1 }}>
            <input style={{ ...inp, fontFamily: MONO }} type="number" min="0" value={form.value} disabled={readOnly}
              onChange={e => setForm({ ...form, value: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Stage" style={{ flex: 1 }}>
            <select style={inp} value={form.stageId} disabled={readOnly}
              onChange={e => setForm({ ...form, stageId: Number(e.target.value) })}>
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>

        {isAdmin && (
          <Field label="Assigned to">
            <select style={inp} value={form.assignedUserId || ''} onChange={e => setForm({ ...form, assignedUserId: e.target.value ? Number(e.target.value) : '' })}>
              <option value="">Unassigned</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username}{u.role === 'admin' ? ' (admin)' : ''}</option>)}
            </select>
          </Field>
        )}

        {/* Contact link */}
        <Field label="Linked contact (optional)">
          {form.contactName || form.contactNumber ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px' }}>
              <span style={{ fontSize: 13, color: C.text }}>{form.contactName || maskPhone(form.contactNumber)} {form.contactNumber && <span style={{ color: C.textMuted, fontFamily: MONO, fontSize: 11 }}>· {maskPhone(form.contactNumber)}</span>}</span>
              {!readOnly && <button onClick={() => setForm({ ...form, contactWaNumber: '', contactNumber: '', contactName: '' })} style={linkBtn}><X size={14} /></button>}
            </div>
          ) : readOnly ? (
            <span style={{ fontSize: 13, color: C.textMuted }}>None</span>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: C.textMuted }} />
                <input style={{ ...inp, paddingLeft: 32 }} value={contactQuery} placeholder="Search contacts by name or number"
                  onChange={e => { setContactQuery(e.target.value); setContactOpen(true); }} onFocus={() => setContactOpen(true)} />
              </div>
              {contactOpen && contactResults.length > 0 && (
                <div style={{ ...dropdownStyle, position: 'absolute', top: 38, left: 0, right: 0, maxHeight: 200, overflowY: 'auto' }}>
                  {contactResults.map((c, i) => (
                    <div key={i} style={dropItemStyle} onClick={() => linkContact(c)}>
                      {c.name || maskPhone(c.contactNumber)} <span style={{ color: C.textMuted, fontSize: 11, fontFamily: MONO }}>· {maskPhone(c.contactNumber)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>

        <div style={{ display: 'flex', gap: 12 }}>
          <Field label="Expected close" style={{ flex: 1 }}>
            <input style={inp} type="date" value={form.expectedCloseDate} disabled={readOnly}
              onChange={e => setForm({ ...form, expectedCloseDate: e.target.value })} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={form.notes} disabled={readOnly}
            onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes…" />
        </Field>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
        <div>
          {isAdmin && editing && (
            <button onClick={remove} style={{ ...ghostBtnStyle, color: C.primary, borderColor: '#F3D2D2' }}><Trash2 size={14} /> Delete</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={ghostBtnStyle}>{readOnly ? 'Close' : 'Cancel'}</button>
          {!readOnly && (
            <button onClick={save} disabled={saving} style={primaryBtnStyle}>
              {saving && <Loader2 size={14} className="spin" />} {editing ? 'Save' : 'Create deal'}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

/* ----------------------------- PipelineModal ------------------------------ */
function PipelineModal({ mode, current, onClose, onSaved }) {
  const [name, setName] = useState(current?.name || '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) { alert('Pipeline name is required'); return; }
    setSaving(true);
    try {
      if (mode === 'rename') { await api.pipelines.update(current.id, name.trim()); onSaved(current.id); }
      else { const p = await api.pipelines.create(name.trim()); onSaved(p.id); }
    } catch (err) { alert(err.message || 'Save failed'); }
    finally { setSaving(false); }
  };
  return (
    <ModalShell onClose={onClose} title={mode === 'rename' ? 'Rename pipeline' : 'New pipeline'} width={420}>
      <Field label="Pipeline name">
        <input style={inp} value={name} autoFocus onChange={e => setName(e.target.value)} placeholder="e.g. Enterprise Sales"
          onKeyDown={e => { if (e.key === 'Enter') save(); }} />
      </Field>
      {mode === 'create' && <p style={{ fontSize: 12, color: C.textMuted, marginTop: 10 }}>Starts with the standard stages (New Lead → Won/Lost). You can edit them via “Manage stages”.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtnStyle}>{saving && <Loader2 size={14} className="spin" />} Save</button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------- StagesModal ------------------------------ */
const STAGE_TYPES = [{ v: 'open', l: 'Open' }, { v: 'won', l: 'Won' }, { v: 'lost', l: 'Lost' }];
function StagesModal({ pipeline, onClose, onChanged }) {
  const [stages, setStages] = useState(pipeline.stages.map(s => ({ ...s })));
  const [busy, setBusy] = useState(false);

  const refreshLocal = async () => {
    const list = await api.pipelines.list();
    const p = list.find(x => x.id === pipeline.id);
    if (p) setStages(p.stages.map(s => ({ ...s })));
    onChanged();
  };

  const saveStage = async (s) => {
    setBusy(true);
    try {
      await api.pipelines.updateStage(s.id, { name: s.name, probability: s.probability, color: s.color, stageType: s.stageType });
      await refreshLocal();
    } catch (err) { alert(err.message || 'Save failed'); }
    finally { setBusy(false); }
  };
  const addStage = async () => {
    setBusy(true);
    try {
      await api.pipelines.addStage(pipeline.id, { name: 'New Stage', probability: 0, stageType: 'open', color: '#64748B' });
      await refreshLocal();
    } catch (err) { alert(err.message || 'Add failed'); }
    finally { setBusy(false); }
  };
  const delStage = async (s) => {
    if (!window.confirm(`Delete stage "${s.name}"?`)) return;
    setBusy(true);
    try { await api.pipelines.deleteStage(s.id); await refreshLocal(); }
    catch (err) { alert(err.message || 'Delete failed'); }
    finally { setBusy(false); }
  };
  const patch = (id, key, val) => setStages(prev => prev.map(s => s.id === id ? { ...s, [key]: val } : s));

  return (
    <ModalShell onClose={onClose} title={`Manage stages · ${pipeline.name}`} width={620}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
        {stages.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${C.border}`, borderRadius: 10, padding: 8 }}>
            <input type="color" value={s.color || '#64748B'} onChange={e => patch(s.id, 'color', e.target.value)} style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }} />
            <input style={{ ...inp, flex: 2 }} value={s.name} onChange={e => patch(s.id, 'name', e.target.value)} />
            <input style={{ ...inp, width: 70, fontFamily: MONO }} type="number" min="0" max="100" value={s.probability} onChange={e => patch(s.id, 'probability', Number(e.target.value))} title="Win probability %" />
            <select style={{ ...inp, width: 90 }} value={s.stageType} onChange={e => patch(s.id, 'stageType', e.target.value)}>
              {STAGE_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <button onClick={() => saveStage(s)} disabled={busy} style={{ ...iconBtnStyle, color: C.green }} title="Save"><Check size={16} /></button>
            <button onClick={() => delStage(s)} disabled={busy} style={{ ...iconBtnStyle, color: C.primary }} title="Delete"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button onClick={addStage} disabled={busy} style={ghostBtnStyle}><Plus size={15} /> Add stage</button>
        <button onClick={onClose} style={primaryBtnStyle}>Done</button>
      </div>
      <p style={{ fontSize: 11, color: C.textMuted, marginTop: 10 }}>Tip: set a stage’s type to <b>Won</b> or <b>Lost</b> so deals dragged there count toward the won/lost KPIs. Edit a row then click ✓ to save it.</p>
    </ModalShell>
  );
}

/* ----------------------------- small primitives --------------------------- */
function ModalShell({ title, width = 480, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg, #fff)', borderRadius: 14, width, maxWidth: '94vw', maxHeight: '92vh', overflow: 'auto', boxShadow: C.shadowLg, padding: 22, fontFamily: FONT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted }}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

/* --------------------------------- styles --------------------------------- */
const inp = { width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: 'none', background: 'var(--c-cardBg, #fff)', color: C.text, boxSizing: 'border-box' };
const primaryBtnStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const ghostBtnStyle = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--c-cardBg, #fff)', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const selectBtnStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--c-cardBg, #fff)', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const iconBtnStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 6, background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer', color: C.textSecondary };
const linkBtn = { display: 'inline-flex', padding: 2, background: 'transparent', border: 'none', cursor: 'pointer', color: C.textMuted };
const overlayStyle = { position: 'fixed', inset: 0, zIndex: 90 };
const dropdownStyle = { position: 'absolute', top: 38, left: 0, background: 'var(--c-cardBg, #fff)', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: C.shadowLg, zIndex: 100, padding: 4, minWidth: 180 };
const dropItemStyle = { padding: '8px 12px', fontSize: 13, color: C.text, cursor: 'pointer', borderRadius: 6, fontFamily: FONT };
