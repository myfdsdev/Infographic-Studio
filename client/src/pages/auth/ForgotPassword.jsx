import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { validateEmail } from '../../utils/validators.js';
import { isNotImplemented } from '../../services/api.js';
import { ROUTES } from '../../utils/constants.js';
import { AuthAlert, PendingAuthNotice } from './authShared.jsx';

export default function ForgotPassword() {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const message = validateEmail(email);
    setFieldError(message);
    if (message) return;
    setSubmitting(true);
    try {
      await forgotPassword({ email: email.trim() });
      setSent(true);
    } catch (err) {
      // The backend answers identically whether or not the email exists, so any
      // error here is real (rate limit, validation, outage) and is shown as is.
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle={`If an account exists for ${email}, a reset link is on its way. It expires in one hour.`}
      >
        <div className="iv-auth__success">
          <span>
            <CheckCircle2 />
          </span>
        </div>
        <Button to={ROUTES.login} icon={ArrowLeft} className="iv-auth__submit">
          Back to sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Forgot password?" subtitle="Enter your email and we will send you reset instructions.">
      <PendingAuthNotice error={error} action="Password reset" />
      {!isNotImplemented(error) && <AuthAlert error={error} />}

      <form onSubmit={submit} className="d-flex flex-column gap-3" noValidate>
        <Input
          icon={Mail}
          type="email"
          placeholder="Email address"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError}
          disabled={submitting}
          aria-label="Email address"
          required
        />
        <Button type="submit" icon={Mail} loading={submitting} className="iv-auth__submit">
          Send reset link
        </Button>
      </form>

      <div className="iv-auth__links">
        <Link to={ROUTES.login} className="d-inline-flex align-items-center gap-1">
          <ArrowLeft size={12} /> Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
