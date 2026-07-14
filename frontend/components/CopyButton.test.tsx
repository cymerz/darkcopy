/**
 * @jest-environment jsdom
 */
// components/CopyButton.test.tsx
import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';
import { CopyButton } from './CopyButton';

describe('CopyButton', () => {
  let writeText: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('renders the default "COPY" label', () => {
    render(<CopyButton content="hello" />);
    expect(screen.getByRole('button')).toHaveTextContent('COPY');
  });

  it('copies the raw content to the clipboard on click', async () => {
    render(<CopyButton content="the raw content" />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(writeText).toHaveBeenCalledWith('the raw content');
  });

  it('shows "COPIED" feedback after a successful copy', async () => {
    render(<CopyButton content="x" />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(screen.getByRole('button')).toHaveTextContent('COPIED');
  });

  it('reverts to the default label after 2 seconds', async () => {
    render(<CopyButton content="x" />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(screen.getByRole('button')).toHaveTextContent('COPIED');

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button')).toHaveTextContent('COPY');
    expect(screen.getByRole('button')).not.toHaveTextContent('COPIED');
  });

  it('shows an error state when the clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CopyButton content="x" />);
    await act(async () => {
      screen.getByRole('button').click();
    });
    expect(screen.getByRole('button')).toHaveTextContent('ERROR');
  });
});
