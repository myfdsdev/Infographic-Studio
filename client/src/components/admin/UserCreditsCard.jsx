import { useState } from 'react';
import { Coins, Plus, Minus } from 'lucide-react';
import Card from '../common/Card.jsx';
import Input from '../common/Input.jsx';
import Button from '../common/Button.jsx';
import ErrorState from '../common/ErrorState.jsx';
import { Skeleton } from '../common/Loader.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { errorMessage } from '../../services/api.js';
import { formatRelative } from '../../utils/formatters.js';

const REASONS = {
  bonus_signup: 'Bonus link sign-up',
  generation: 'Infographic',
  refund: 'Refund',
  admin_adjustment: 'Admin adjustment',
};

/** An account's platform credits: balance, add/remove, history. */
export default function UserCreditsCard({ userId, credits: initialCredits, onChanged }) {
  const { toast } = useToast();
  const history = useApiResource((signal) => adminApi.userCredits(userId, { signal }), [userId]);
  const [credits, setCredits] = useState(initialCredits ?? 0);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);

  const adjust = async (sign) => {
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      toast.error('Enter a whole number of credits.');
      return;
    }
    setBusy(sign);
    try {
      const result = await adminApi.adjustCredits(userId, { amount: sign * value, note: note.trim() || undefined });
      setCredits(result.credits);
      onChanged?.(result.credits);
      setAmount('');
      setNote('');
      history.reload();
      toast.success(`${sign > 0 ? 'Added' : 'Removed'} ${value} credits.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const transactions = history.data?.transactions || [];

  return (
    <Card
      title={
        <span className="d-inline-flex align-items-center gap-2">
          <Coins size={16} aria-hidden="true" /> Credits
        </span>
      }
      subtitle="Spent before the user's own key. Changes are recorded in the audit log."
    >
      <div className="d-flex flex-column gap-3">
        <div className="iv-credits">
          <span className="iv-credits__value">{credits}</span>
          <span className="iv-credits__unit">credits</span>
        </div>
        <div className="iv-form-grid iv-form-grid--2">
          <Input label="Amount" type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} />
          <Input label="Note (optional)" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div className="d-flex gap-2">
          <Button size="sm" icon={Plus} loading={busy === 1} onClick={() => adjust(1)}>
            Add credits
          </Button>
          <Button variant="secondary" size="sm" icon={Minus} loading={busy === -1} onClick={() => adjust(-1)}>
            Remove credits
          </Button>
        </div>
        {history.loading && !history.data ? (
          <Skeleton height={80} />
        ) : history.error ? (
          <ErrorState plain title="Could not load the credit history" error={history.error} onRetry={history.reload} />
        ) : transactions.length > 0 ? (
          <div>
            {transactions.slice(0, 10).map((entry) => (
              <div key={entry.id} className="iv-credit-row">
                <span>
                  {REASONS[entry.reason] || entry.reason}
                  {entry.note && <span className="iv-muted"> · {entry.note}</span>}
                  <span className="iv-muted"> · {formatRelative(entry.createdAt)}</span>
                </span>
                <span className={`iv-credit-row__amount ${entry.amount > 0 ? 'is-plus' : ''}`}>
                  {entry.amount > 0 ? '+' : ''}
                  {entry.amount}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="iv-muted small mb-0">No credit activity yet.</p>
        )}
      </div>
    </Card>
  );
}
