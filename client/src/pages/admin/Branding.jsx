import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import Card from '../../components/common/Card.jsx';
import Button from '../../components/common/Button.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx';
import { Skeleton } from '../../components/common/Loader.jsx';
import BrandingForm from '../../components/admin/BrandingForm.jsx';
import { useApiResource } from '../../hooks/useApiResource.js';
import { useBranding } from '../../hooks/useBranding.js';
import { useToast } from '../../hooks/useToast.js';
import { adminApi } from '../../services/adminApi.js';
import { API_BASE_URL, errorMessage } from '../../services/api.js';
import { formatDateTime } from '../../utils/formatters.js';

/** App name, tagline, accent colour, logo and favicon. Saved on the server and applied for every visitor. */
export default function Branding() {
  const { toast } = useToast();
  const branding = useBranding();
  const resource = useApiResource((signal) => adminApi.getBranding({ signal }));
  const saved = resource.data?.branding;
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyImage, setBusyImage] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    if (saved) setForm({ appName: saved.appName, tagline: saved.tagline || '', accentColor: saved.accentColor });
  }, [saved]);

  // Push the saved branding to the whole app at once.
  const applySaved = (next) => {
    resource.setData({ branding: next });
    branding.apply(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await adminApi.updateBranding(form);
      applySaved(result.branding);
      toast.success('Branding saved');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind, file) => {
    setBusyImage(kind);
    try {
      const result = await adminApi.uploadBrandingImage(kind, file);
      applySaved(result.branding);
      toast.success(kind === 'logo' ? 'Logo updated' : 'Favicon updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyImage(null);
    }
  };

  const resetImage = async (kind) => {
    setBusyImage(kind);
    try {
      const result = await adminApi.resetBrandingImage(kind);
      applySaved(result.branding);
      toast.success(kind === 'logo' ? 'Default logo restored' : 'Default favicon restored');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyImage(null);
    }
  };

  const resetAll = async () => {
    setResetting(true);
    try {
      const result = await adminApi.resetBranding();
      applySaved(result.branding);
      toast.success('Branding reset to the AI Infographic Studio defaults');
      setConfirmReset(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResetting(false);
    }
  };

  const images = saved
    ? {
        logoUrl: saved.logoPath ? `${API_BASE_URL}${saved.logoPath}` : branding.defaultLogoUrl,
        faviconUrl: saved.faviconPath ? `${API_BASE_URL}${saved.faviconPath}` : branding.defaultFaviconUrl,
        customLogo: saved.customLogo,
        customFavicon: saved.customFavicon,
      }
    : null;

  return (
    <Card
      title={<span className="iv-gradient-text">Branding</span>}
      subtitle={
        saved?.updatedAt
          ? `Applies to every visitor, including the sign-in pages. Last changed ${formatDateTime(saved.updatedAt)} by ${saved.updatedBy}.`
          : 'Applies to every visitor, including the sign-in pages. Currently the AI Infographic Studio defaults.'
      }
      actions={
        <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => setConfirmReset(true)} disabled={!saved}>
          Reset to defaults
        </Button>
      }
    >
      {resource.loading && !saved ? (
        <Skeleton height={360} />
      ) : resource.error ? (
        <ErrorState plain title="Could not load branding" error={resource.error} onRetry={resource.reload} />
      ) : form ? (
        <BrandingForm value={form} onChange={setForm} onSubmit={save} saving={saving} images={images} busyImage={busyImage} onUpload={upload} onResetImage={resetImage} />
      ) : null}
      <ConfirmDialog
        open={confirmReset}
        title="Reset branding?"
        message="The name goes back to AI Infographic Studio, the accent to the default ink theme, and the supplied logo and favicon are used again. Uploaded images are deleted."
        confirmLabel="Reset"
        danger
        loading={resetting}
        onConfirm={resetAll}
        onCancel={() => setConfirmReset(false)}
      />
    </Card>
  );
}
