import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, LogIn, ArrowRight } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { validateEmail, validateForm } from '../../utils/validators.js';
import { isNotImplemented } from '../../services/api.js';
import { ROUTES } from '../../utils/constants.js';
import { AuthAlert, PendingAuthNotice } from './authShared.jsx';
import { GoogleButton, googleMessage, googleStartUrl, useGoogleAvailable } from '../../components/auth/GoogleSignIn.jsx';

export default function Login() {
  const { login, status, isPreview, enablePreview } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || ROUTES.dashboard;
  // Where Google sends the user back to (a path inside the app).
  const fromPath = typeof from === 'string' ? from : `${from?.pathname || '/'}${from?.search || ''}`;
  const googleCode = new URLSearchParams(location.search).get('google');
  const googleAvailable = useGoogleAvailable();

  const [values, setValues] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (event) => setValues((prev) => ({ ...prev, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    const { errors: fieldErrors, valid } = validateForm(values, {
      email: validateEmail,
      password: (value) => (value ? null : 'Password is required'),
    });
    setErrors(fieldErrors);
    if (!valid) return;
    setSubmitting(true);
    try {
      await login(values);
      navigate(from, { replace: true });
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

  if (status === 'authenticated') {
    return (
      <AuthLayout title="Welcome back" subtitle="You are already signed in.">
        <Button to={ROUTES.dashboard} iconRight={ArrowRight} className="iv-auth__submit">
          Go to dashboard
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to turn your topics into professional infographics."
    >
      {location.state?.notice === 'suspended' && !error && (
        <AuthAlert>This account is suspended. Contact the administrator if you think this is a mistake.</AuthAlert>
      )}
      <PendingAuthNotice error={error} onPreview={startPreview} />
      {!isNotImplemented(error) && <AuthAlert error={error} />}
      {googleCode && !error && <AuthAlert>{googleMessage(googleCode)}</AuthAlert>}

      {googleAvailable && (
        <>
          <GoogleButton href={googleStartUrl(fromPath)} />
          <div className="iv-auth__divider">or sign in with email</div>
        </>
      )}

      <form onSubmit={submit} className="d-flex flex-column gap-3" noValidate>
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
          placeholder="Password"
          autoComplete="current-password"
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
        <div className="d-flex justify-content-end">
          <Link to={ROUTES.forgotPassword} className="small fw-semibold">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" icon={LogIn} loading={submitting} className="iv-auth__submit">
          Sign in
        </Button>
      </form>

      <div className="iv-auth__links">
        Don&apos;t have an account? <Link to={ROUTES.signup}>Sign up</Link>
      </div>

      {isPreview && (
        <div className="iv-auth__links">
          <Link to={ROUTES.dashboard}>Continue in preview mode</Link>
        </div>
      )}
    </AuthLayout>
  );
}
