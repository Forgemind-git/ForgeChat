import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatWindow from '../ChatWindow.jsx';

// Mock the api module — ChatWindow talks to the backend only through it.
vi.mock('../../api.js', () => ({
  api: {
    saveContact: vi.fn(),
    contact: vi.fn(),
    contactNames: vi.fn(),
    markRead: vi.fn(),
    messages: vi.fn(),
    windowStatus: vi.fn(),
    contacts: vi.fn(),
    numbers: vi.fn(),
    resolveAccountByPhone: vi.fn(),
    categories: { list: vi.fn() },
    tags: { list: vi.fn() },
    users: { list: vi.fn() },
    contactFields: { list: vi.fn() },
    mediaLibrary: { list: vi.fn(), downloadUrl: vi.fn() },
    sendMessage: vi.fn(), sendMedia: vi.fn(), sendAudio: vi.fn(), sendLibraryMedia: vi.fn(),
  },
}));
import { api } from '../../api.js';

const WA = '97300000000';
const CN = '97333757214';
const CATEGORIES = [{ id: 'cat-1', name: 'Status' }, { id: 'cat-2', name: 'Stage' }];
const TAGS = [
  { id: 't1', name: 'VIP', color: '#dc2626', category_id: 'cat-1' },
  { id: 't2', name: 'Cold', color: '#999999', category_id: 'cat-1' },
  { id: 't3', name: 'Hot', color: '#16a34a', category_id: 'cat-2' },
];
const USERS = [
  { id: 1, displayName: 'Riya', username: 'riya', role: 'bda_sales', isActive: true },
  { id: 2, displayName: 'Sam', username: 'sam', role: 'admin', isActive: true },
];

function setContact({ tags = [], assigned_user_id = null } = {}) {
  api.contact.mockResolvedValue({ contact_number: CN, name: 'Sivapriya', tags, custom_fields: {}, assigned_user_id });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.contactNames.mockResolvedValue({ [CN]: 'Sivapriya' });
  setContact();
  api.messages.mockResolvedValue({ messages: [], totalPages: 1 });
  api.markRead.mockResolvedValue({ ok: true });
  api.windowStatus.mockResolvedValue({ canSendFreeForm: true });
  api.categories.list.mockResolvedValue(CATEGORIES);
  api.tags.list.mockResolvedValue(TAGS);
  api.users.list.mockResolvedValue(USERS); // admin by default
  api.contactFields.list.mockResolvedValue([]);
  api.saveContact.mockResolvedValue({ ok: true });
  // other mount-time calls (avatar/account resolution, media, composer)
  api.numbers.mockResolvedValue([]);
  api.resolveAccountByPhone.mockResolvedValue(null);
  api.contacts.mockResolvedValue([]);
  api.mediaLibrary.list.mockResolvedValue([]);
  api.mediaLibrary.downloadUrl.mockResolvedValue('');
  api.sendMessage.mockResolvedValue({ ok: true });
  api.sendMedia.mockResolvedValue({ ok: true });
  api.sendAudio.mockResolvedValue({ ok: true });
  api.sendLibraryMedia.mockResolvedValue({ ok: true });
});

const renderCW = () => render(<ChatWindow waNumber={WA} contactNumber={CN} onContactSaved={() => {}} />);

describe('ChatWindow header — tag + assign quick-actions', () => {
  it('renders Tag and (admin) Assign buttons in the header', async () => {
    renderCW();
    expect(await screen.findByTitle('Tags')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle('Assign to')).toBeInTheDocument());
  });

  it('opens the tag popover grouped by category and persists a tag with a blank name', async () => {
    const user = userEvent.setup();
    renderCW();
    await user.click(await screen.findByTitle('Tags'));

    // category headings + tags visible
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Stage')).toBeInTheDocument();
    await user.click(screen.getByText('VIP'));

    await waitFor(() => expect(api.saveContact).toHaveBeenCalled());
    const [wa, cn, name, tags] = api.saveContact.mock.calls[0];
    expect(wa).toBe(WA);
    expect(cn).toBe(CN);
    expect(name).toBe('');                              // blank name => backend preserves it
    expect(tags.map(t => t.id)).toContain('t1');        // VIP added
  });

  it('enforces one tag per category (selecting a sibling replaces it)', async () => {
    const user = userEvent.setup();
    setContact({ tags: [{ id: 't1', name: 'VIP', color: '#dc2626', category_id: 'cat-1' }] });
    renderCW();
    await user.click(await screen.findByTitle('Tags'));
    await user.click(screen.getByText('Cold'));         // t2, same category cat-1 as t1

    await waitFor(() => expect(api.saveContact).toHaveBeenCalled());
    const tags = api.saveContact.mock.calls[0][3];
    const ids = tags.map(t => t.id);
    expect(ids).toContain('t2');                        // new tag in
    expect(ids).not.toContain('t1');                    // old same-category tag replaced
  });

  it('hides the Assign button for non-admins (users.list 403s)', async () => {
    api.users.list.mockRejectedValue(new Error('403 Forbidden'));
    renderCW();
    expect(await screen.findByTitle('Tags')).toBeInTheDocument();   // tag still available
    await waitFor(() => expect(api.contact).toHaveBeenCalled());
    expect(screen.queryByTitle('Assign to')).not.toBeInTheDocument();
  });

  it('assigns the contact to a user via the assign popover', async () => {
    const user = userEvent.setup();
    renderCW();
    await user.click(await screen.findByTitle('Assign to'));

    const popoverUser = await screen.findByText(/Sam/);
    await user.click(popoverUser);

    await waitFor(() => expect(api.saveContact).toHaveBeenCalled());
    const call = api.saveContact.mock.calls[0];
    expect(call[2]).toBe('');        // blank name
    expect(call[5]).toBe(2);         // assignedUserId = Sam's id
  });

  it('can unassign the contact', async () => {
    const user = userEvent.setup();
    setContact({ assigned_user_id: 2 });
    renderCW();
    await user.click(await screen.findByTitle('Assign to'));
    await user.click(await screen.findByText('Unassigned'));

    await waitFor(() => expect(api.saveContact).toHaveBeenCalled());
    expect(api.saveContact.mock.calls[0][5]).toBe(null);  // cleared
  });
});
