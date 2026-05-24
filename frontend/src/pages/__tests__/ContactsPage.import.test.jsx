import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactsPage from '../ContactsPage.jsx';

vi.mock('../../api.js', () => ({
  api: {
    numbers: vi.fn(),
    savedContacts: vi.fn(),
    contact: vi.fn(),
    saveContact: vi.fn(),
    deleteContact: vi.fn(),
    importContacts: vi.fn(),
    importContactsTemplateUrl: vi.fn(() => '/api/contacts/import/template'),
    categories: { list: vi.fn() },
    tags: { list: vi.fn() },
    contactFields: { list: vi.fn() },
    users: { list: vi.fn() },
    templates: { list: vi.fn() },
    broadcasts: { create: vi.fn(), send: vi.fn(), test: vi.fn() },
    mediaLibrary: { list: vi.fn(), downloadUrl: vi.fn() },
  },
}));
import { api } from '../../api.js';

const WA = '97333757214';

beforeEach(() => {
  vi.clearAllMocks();
  api.numbers.mockResolvedValue([{ wa_number: WA, display_name: 'Sales Line' }]);
  api.savedContacts.mockResolvedValue([]);
  api.categories.list.mockResolvedValue([]);
  api.tags.list.mockResolvedValue([]);
  api.contactFields.list.mockResolvedValue([]);
  api.users.list.mockResolvedValue([]);
  api.templates.list.mockResolvedValue([]);
  api.mediaLibrary.list.mockResolvedValue([]);
  api.importContactsTemplateUrl.mockReturnValue('/api/contacts/import/template');
  api.importContacts.mockResolvedValue({ ok: true, imported: 2, updated: 1, skipped: [{ row: 4, reason: 'Missing name' }], total: 5 });
});

const renderPage = () => render(<ContactsPage user={{ role: 'admin' }} />);

describe('ContactsPage — Import contacts', () => {
  it('shows an Import button once a WhatsApp number is loaded', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Import' });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it('opens the import modal with sample-download and a dropzone', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Import' }));

    expect(await screen.findByRole('heading', { name: 'Import Contacts' })).toBeInTheDocument();
    expect(screen.getByText(/Download sample sheet/)).toBeInTheDocument();
    expect(screen.getByText(/paste \(Ctrl\+V\)/)).toBeInTheDocument();
    // target number shown in the copy (also appears in the <select>, hence getAllByText)
    expect(screen.getAllByText('Sales Line').length).toBeGreaterThan(0);
  });

  it('rejects a non-csv/xlsx file with a friendly error', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    const input = container.querySelector('input[type="file"]');
    // fireEvent.change bypasses the input's accept filter (the app guard exists for
    // the drag-drop / Ctrl+V paste paths, where accept doesn't apply).
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText('Please choose a .csv or .xlsx file.')).toBeInTheDocument();
    expect(api.importContacts).not.toHaveBeenCalled();
  });

  it('uploads a sheet and shows the Added/Updated/Skipped summary', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Import' }));

    const input = container.querySelector('input[type="file"]');
    const file = new File(['Name,Phone\nAlice,919876543210'], 'contacts.csv', { type: 'text/csv' });
    await user.upload(input, file);
    expect(await screen.findByText('contacts.csv')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Import contacts/ }));

    await waitFor(() => expect(api.importContacts).toHaveBeenCalledTimes(1));
    expect(api.importContacts.mock.calls[0][0]).toBe(WA);      // scoped to selected number
    expect(api.importContacts.mock.calls[0][1]).toBe(file);    // the uploaded file

    // result summary
    expect(await screen.findByText('Import complete')).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Row 4: Missing name')).toBeInTheDocument();
    // list refreshed after import (mount call + post-import call)
    expect(api.savedContacts.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
