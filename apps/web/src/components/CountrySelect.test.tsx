import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { COUNTRY_CODES, flagOf } from '@/lib/details';
import { CountrySelect } from './CountrySelect';

describe('phone country picker', () => {
  it('turns an ISO code into its flag', () => {
    expect(flagOf('TG')).toBe('🇹🇬');
    expect(flagOf('ci')).toBe('🇨🇮');
  });

  it('lists countries by name with flag and code, and shows the compact choice', () => {
    render(<CountrySelect value="+228" onChange={() => {}} />);
    const select = screen.getByRole('combobox', { name: /Pays de votre numéro : Togo/ });
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toHaveLength(COUNTRY_CODES.length);
    expect(options[0]).toBe('🇹🇬 Togo (+228)');
    expect(options).toContain('🇨🇲 Cameroun (+237)');
    expect(select).toHaveValue('+228');
    expect(screen.getByText('+228', { selector: 'span' })).toBeInTheDocument();
  });

  it('reports the chosen dialling code', async () => {
    const onChange = vi.fn();
    render(<CountrySelect value="+228" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), '🇧🇯 Bénin (+229)');
    expect(onChange).toHaveBeenCalledWith('+229');
  });
});
