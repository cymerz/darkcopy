/**
 * @jest-environment jsdom
 */
// components/ErrorDisplay.test.tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { ErrorDisplay } from './ErrorDisplay';

describe('ErrorDisplay', () => {
  it('renders the required title as a heading', () => {
    render(<ErrorDisplay title="Not Found" />);
    expect(
      screen.getByRole('heading', { name: 'Not Found' }),
    ).toBeInTheDocument();
  });

  it('exposes the card as an alert region', () => {
    render(<ErrorDisplay title="An Error Occurred" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the optional message when provided', () => {
    render(
      <ErrorDisplay
        title="Content Expired"
        message="This content has been automatically deleted."
      />,
    );
    expect(
      screen.getByText('This content has been automatically deleted.'),
    ).toBeInTheDocument();
  });

  it('omits the message paragraph when no message is provided', () => {
    const { container } = render(<ErrorDisplay title="Not Found" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders the action as a link pointing at the given href', () => {
    render(
      <ErrorDisplay
        title="Not Found"
        action={{ label: 'Back to Home', href: '/' }}
      />,
    );
    const link = screen.getByRole('link', { name: /Back to Home/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });

  it('does not render a link when no action is provided', () => {
    render(<ErrorDisplay title="Not Found" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a provided custom icon instead of the default', () => {
    render(
      <ErrorDisplay
        title="Content Expired"
        icon={<svg data-testid="custom-icon" />}
      />,
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('renders a default icon when none is provided', () => {
    const { container } = render(<ErrorDisplay title="An Error Occurred" />);
    // The default alert icon is the only <svg> rendered in this case.
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
