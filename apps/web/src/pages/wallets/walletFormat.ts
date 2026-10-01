const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** `-807.48` → `-$807.48`, the same shape the legacy app shows in its header. */
export const formatUsd = (value: number) => usd.format(value);

/** The balance may go down to −creditLimit; anything below that is debt the seller was never allowed. */
export const isOverLimit = (balance: number, creditLimit: number) => balance < -creditLimit;
