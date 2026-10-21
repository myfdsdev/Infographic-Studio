import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Lock, Eye, EyeOff, CheckCircle2, ArrowRight, KeyRound } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { validatePassword, validatePasswordMatch, validateForm } from '../../utils/validators.js';
import { isNotImplemented } from '../../services/api.js';
import { ROUTES } from '../../utils/constants.js';
import { AuthAlert, PendingAuthNotice } from './authShared.jsx';

export default function ResetPassword() {
  const { resetPassword } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [values, setValues] = useState({ password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const set = (field) => (event) => setValues((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const { errors: fieldErrors, valid } = validateForm(values, {
      password: validatePassword,
      confirm: (value, all) => validatePasswordMatch(all.password, value),
    });
    setErrors(fieldErrors);
    if (!valid) return;
    setSubmitting(true);
    try {
      await resetPassword({ token, password: values.password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Invalid reset link" subtitle="This link is missing its token. Request a new one to continue.">
        <Button to={ROUTES.forgotPassword} icon={KeyRound} className="iv-auth__submit">
          Request a new link
        </Button>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="Password updated" subtitle="You can sign in with your new password now.">
        <div className="iv-auth__success">
          <span>
            <CheckCircle2 />
          </span>
        </div>
        <Button to={ROUTES.login} iconRight={ArrowRight} className="iv-auth__submit">
          Go to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set a new password" subtitle="Choose a strong password you have not used before.">
      <PendingAuthNotice error={error} action="Password reset" />
      {!isNotImplemented(error) && <AuthAlert error={error} />}

      <form onSubmit={submit} className="d-flex flex-column gap-3" noValidate>
        <Input
          icon={Lock}
          type={showPassword ? 'text' : 'password'}
          placeholder="New password"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          disabled={submitting}
          aria-label="New password"
          required
          right={
            <button
              type="button"
              className="btn btn-iv-ghost btn-sm btn-iv-icon"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          }
        />
        <Input
          icon={Lock}
          type={showPassword ? 'text' : 'password'}
          placeholder="Confirm new password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
          disabled={submitting}
          aria-label="Confirm new password"
          required
        />
        <Button type="submit" icon={KeyRound} loading={submitting} className="iv-auth__submit">
          Update password
        </Button>
      </form>

      <div className="iv-auth__links">
        <Link to={ROUTES.login}>Back to sign in</Link>
      </div>
    </AuthLayout>
  );
}
