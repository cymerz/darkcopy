/**
 * @jest-environment jsdom
 */
// components/PasteForm.test.tsx
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PasteForm } from './PasteForm';
import type { ExpiryOption, Language } from '@/lib/types';
import { APIError } from '@/lib/types';

// --- Mocks -----------------------------------------------------------------

const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const createPasteMock = jest.fn();
jest.mock('@/lib/api', () => ({
  createPaste: (data: FormData) => createPasteMock(data),
}));

// --- Fixtures --------------------------------------------------------------

const LANGUAGES: Language[] = [
  { id: 'plaintext', name: 'Plain Text' },
  { id: 'go', name: 'Go' },
];

const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '1 Hour', duration: 60 },
  { label: '24 Hours', duration: 1440 },
];

function renderForm() {
  return render(
    <PasteForm languages={LANGUAGES} expiryOptions={EXPIRY_OPTIONS} />,
  );
}

beforeEach(() => {
  pushMock.mockReset();
  createPasteMock.mockReset();
});

// --- Tests -----------------------------------------------------------------

describe('PasteForm', () => {
  it('renders content, title, language, expiry, and visibility controls', () => {
    renderForm();
    expect(screen.getByLabelText(/CONTENT/)).toBeRequired();
    expect(screen.getByLabelText(/PASTE_TITLE/)).toBeInTheDocument();
    expect(screen.getByLabelText('LANGUAGE_SPEC')).toBeInTheDocument();
    expect(screen.getByLabelText('EXPIRED_IN')).toBeInTheDocument();
    expect(screen.getByLabelText('PUBLIC')).toBeInTheDocument();
    expect(screen.getByLabelText('UNLISTED')).toBeInTheDocument();
    expect(screen.getByLabelText('PROTECTED')).toBeInTheDocument();
  });

  it('hides the password field until password_protected is selected (Req 2.3)', () => {
    renderForm();
    expect(screen.queryByLabelText('PASSWORD')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('PROTECTED'));
    expect(screen.getByLabelText('PASSWORD')).toBeInTheDocument();
  });

  it('renders a line number for each content line (Req 2.7)', () => {
    renderForm();
    const textarea = screen.getByLabelText(/CONTENT/);
    fireEvent.change(textarea, { target: { value: 'line1\nline2\nline3' } });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('submits the expected backend field names and redirects on success (Req 2.4)', async () => {
    createPasteMock.mockResolvedValue({ slug: 'abc123', url: '/abc123' });
    renderForm();

    fireEvent.change(screen.getByLabelText(/CONTENT/), {
      target: { value: 'hello world' },
    });
    fireEvent.change(screen.getByLabelText(/PASTE_TITLE/), {
      target: { value: 'My Title' },
    });
    fireEvent.change(screen.getByLabelText('LANGUAGE_SPEC'), {
      target: { value: 'go' },
    });
    fireEvent.change(screen.getByLabelText('EXPIRED_IN'), {
      target: { value: '1440' },
    });

    fireEvent.submit(screen.getByRole('button', { name: /> CREATE PASTE/ }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/abc123'));

    const formData = createPasteMock.mock.calls[0][0] as FormData;
    expect(formData.get('content')).toBe('hello world');
    expect(formData.get('title')).toBe('My Title');
    expect(formData.get('language')).toBe('go');
    expect(formData.get('expires_in')).toBe('1440');
    expect(formData.get('visibility')).toBe('public');
    // Password omitted when not password_protected.
    expect(formData.get('password')).toBeNull();
  });

  it('includes the password field when password_protected is selected', async () => {
    createPasteMock.mockResolvedValue({ slug: 'pw1', url: '/pw1' });
    renderForm();

    fireEvent.change(screen.getByLabelText(/CONTENT/), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByLabelText('PROTECTED'));
    fireEvent.change(screen.getByLabelText('PASSWORD'), {
      target: { value: 's3cr3t' },
    });

    fireEvent.submit(screen.getByRole('button', { name: /> CREATE PASTE/ }));

    await waitFor(() => expect(createPasteMock).toHaveBeenCalled());
    const formData = createPasteMock.mock.calls[0][0] as FormData;
    expect(formData.get('visibility')).toBe('password_protected');
    expect(formData.get('password')).toBe('s3cr3t');
  });

  it('shows the backend error message and preserves input on failure (Req 2.5)', async () => {
    createPasteMock.mockRejectedValue(
      new APIError('Content cannot be empty', 'VALIDATION_ERROR', 400),
    );
    renderForm();

    const textarea = screen.getByLabelText(/CONTENT/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'keep me' } });

    fireEvent.submit(screen.getByRole('button', { name: /> CREATE PASTE/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Content cannot be empty',
    );
    // Input preserved, no navigation.
    expect(textarea.value).toBe('keep me');
    expect(pushMock).not.toHaveBeenCalled();
  });
});
