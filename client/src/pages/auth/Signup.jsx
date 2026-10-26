import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, User, Eye, EyeOff, UserPlus, CheckCircle2, ArrowRight, Gift } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { validateEmail, validateName, validatePassword, validatePasswordMatch, validateForm } from '../../utils/validators.js';
import { isNotImplemented } from '../../services/api.js';
import { ROUTES } from '../../utils/constants.js';
import { AuthAlert, PendingAuthNotice } from './authShared.jsx';
import { GoogleButton, googleStartUrl, useGoogleAvailable } from '../../components/auth/GoogleSignIn.jsx';
import { useBranding } from '../../hooks/useBranding.js';
import { useToast } from '../../hooks/useToast.js';
import { authApi } from '../../services/authApi.js';

const BONUS_REASONS = {
  expired: 'This bonus link has expired, but you can still create a free account.',
  used_up: 'This bonus link has been fully claimed, but you can still create a free account.',
  disabled: 'This bonus link is no longer active, but you can still create a free account.',
  not_found: 'This bonus link is not valid, but you can still create a free account.',
};

/** ?bonus=<code>: what the link gives, checked with the server. */
function useBonus() {
  const [params] = useSearchParams();
  const code = (params.get('bonus') || '').trim();
  const [bonus, setBonus] = useState(null);
  useEffect(() => {
    if (!code) return undefined;
    const controller = new AbortController();
    authApi
      .describeBonus(code, { signal: controller.signal })
      .then(setBonus)
      .catch(() => {});
    return () => controller.abort();
  }, [code]);
  return { code, bonus };
}

function BonusBanner({ bonus }) {
  if (!bonus) return null;
  if (!bonus.valid) {
    return <div className="iv-bonus-banner iv-bonus-banner--muted">{BONUS_REASONS[bonus.reason] || BONUS_REASONS.not_found}</div>;
  }
  return (
    <div className="iv-bonus-banner" role="status">
      <Gift size={18} aria-hidden="true" />
      <span>
        <strong>{bonus.credits} free credits</strong> are added to your account when you sign up with this link.
      </span>
    </div>
  );
}

export default function Signup() {
  const { appName } = useBranding();
  const { signup, enablePreview } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const googleAvailable = useGoogleAvailable();
  const { code: bonusCode, bonus } = useBonus();
  const sendBonus = bonusCode && bonus?.valid ? bonusCode : undefined;

  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const set = (field) => (event) => setValues((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const { errors: fieldErrors, valid } = validateForm(values, {
      name: validateName,
      email: validateEmail,
      password: validatePassword,
      confirm: (value, all) => validatePasswordMatch(all.password, value),
    });
    setErrors(fieldErrors);
    if (!valid) return;
    setSubmitting(true);
    try {
      const result = await signup({
        name: values.name.trim(),
        email: values.email.trim(),
        password: values.password,
        bonusCode: sendBonus,
      });
      if (result?.bonus?.credits) toast.success(`Welcome! ${result.bonus.credits} free credits were added to your account.`);
      if (result?.user) {
        navigate(ROUTES.dashboard, { replace: true });
      } else {
        setCreated(result || {});
      }
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const startPreview = () => {
    enablePreview();
    navigate(ROUTES.dashboard, { replace: true });
  };

  if (created) {
    return (
      <AuthLayout title="Account created" subtitle={created.message || 'You can sign in now.'}>
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
    <AuthLayout
      title="Create your account"
      subtitle={`Create your ${appName} account. Generate with your credits, or connect your own Kie.ai API key.`}
    >
      <BonusBanner bonus={bonus} />
      <PendingAuthNotice error={error} onPreview={startPreview} action="Sign-up" />
      {!isNotImplemented(error) && <AuthAlert error={error} />}

      {googleAvailable && (
        <>
          <GoogleButton href={googleStartUrl(undefined, { bonusCode: sendBonus })}>Sign up with Google</GoogleButton>
          <div className="iv-auth__divider">or sign up with email</div>
        </>
      )}

      <form onSubmit={submit} className="d-flex flex-column gap-3" noValidate>
        <Input
          icon={User}
          placeholder="Your name"
          autoComplete="name"
          value={values.name}
          onChange={set('name')}
          error={errors.name}
          disabled={submitting}
          aria-label="Your name"
          required
        />
        <Input
          icon={Mail}
          type="email"
          placeholder="Email address"
          autoComplete="email"
          value={values.email}
          onChange={set('email')}
          error={errors.email}
          disabled={submitting}
          aria-label="Email address"
          required
        />
        <Input
          icon={Lock}
          type={showPassword ? 'text' : 'password'}
          placeholder="Password (8+ characters, letters and numbers)"
          autoComplete="new-password"
          value={values.password}
          onChange={set('password')}
          error={errors.password}
          disabled={submitting}
          aria-label="Password"
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
          placeholder="Confirm password"
          autoComplete="new-password"
          value={values.confirm}
          onChange={set('confirm')}
          error={errors.confirm}
          disabled={submitting}
          aria-label="Confirm password"
          required
        />
        <Button type="submit" icon={UserPlus} loading={submitting} className="iv-auth__submit">
          Create account
        </Button>
      </form>

      <div className="iv-auth__links">
        Already have an account? <Link to={ROUTES.login}>Sign in</Link>
      </div>
    </AuthLayout>
  );
}
