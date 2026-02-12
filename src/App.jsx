import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'gp_admin_token';
const USER_KEY = 'gp_admin_user';
const TODAY_STR = new Date().toISOString().slice(0, 10);

/** Parse une réponse en JSON ; si le serveur renvoie du HTML (SPA fallback), lance une erreur claire. */
async function parseJsonResponse(res) {
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    throw new Error(
      "Le serveur a renvoyé une"
    );
  }
  try {
    return trimmed ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error("Réponse du serveur invalide.");
  }
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(() => {
    try {
      const u = localStorage.getItem(USER_KEY);
      return u ? JSON.parse(u) : null;
    } catch {
      return null;
    }
  });
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await parseJsonResponse(res);
        if (!res.ok) throw new Error(data?.message || 'Erreur');
        return data;
      })
      .then((data) => {
        const u = data?.user;
        if (u && (u.role === 'admin' || u.role === 'gestionnaire')) {
          setUser(u);
          localStorage.setItem(USER_KEY, JSON.stringify(u));
        } else {
          setToken(null);
          setUser(null);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      });
  }, [token]);

  const fetchFields = async (type) => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (type && type !== 'all') params.set('type', type);
      const url = params.toString() ? `${API_BASE_URL}/fields?${params}` : `${API_BASE_URL}/fields`;
      const res = await fetch(url);
      const data = await res.json();
      setFields(data);
    } catch (e) {
      console.error(e);
      setError('Impossible de charger les terrains.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSuccess = ({ token: t, user: u }) => {
    if (u?.role !== 'admin' && u?.role !== 'gestionnaire') return;
    setToken(t);
    setUser(u);
    localStorage.setItem(TOKEN_KEY, t);
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    navigate('/admin', { replace: true });
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    navigate('/');
  };

  const isAdminOrManager = user?.role === 'admin' || user?.role === 'gestionnaire';

  return (
    <div className="app-shell">
      <header className="shell-header">
        <div className="brand">
          <Link to="/" className="brand-link">
            <div className="brand-mark">ST</div>
            <div className="brand-text">
              <span className="brand-title">SAMA TERRAIN</span>
              <span className="brand-subtitle">Réservez votre terrain synthétique</span>
            </div>
          </Link>
        </div>
        <div className="nav-actions">
          {isAdminOrManager && location.pathname.startsWith('/admin') && (
            <>
              <span className="user-pill">{user?.name} · {user?.role === 'admin' ? 'Admin' : 'Gestionnaire'}</span>
              <button type="button" className="ghost-button" onClick={logout}>
                Déconnexion
              </button>
              <Link to="/" className="ghost-button">
                Voir le site
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="shell-main">
        <Routes>
          <Route
            path="/"
            element={
              <PublicHome
                fields={fields}
                fetchFields={fetchFields}
                loading={loading}
                error={error}
                onReservationCreated={() => {}}
              />
            }
          />
          <Route
            path="/login"
            element={
              isAdminOrManager ? (
                <Navigate to="/admin" replace />
              ) : (
                <AuthPanel apiBase={API_BASE_URL} onAuthSuccess={handleAuthSuccess} />
              )
            }
          />
          <Route
            path="/admin"
            element={
              isAdminOrManager ? (
                <AdminDashboard apiBase={API_BASE_URL} token={token} onLogout={logout} user={user} />
              ) : (
                <Navigate to="/login" replace state={{ from: '/admin' }} />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {error && <div className="toast toast-error">{error}</div>}
    </div>
  );
}

function PublicHome({ fields, fetchFields, loading, error, token, onReservationCreated }) {
  const [selectedField, setSelectedField] = useState(null);
  const [fieldType, setFieldType] = useState('all');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [address, setAddress] = useState('');
  const [step, setStep] = useState('slots'); // 'slots' | 'info'
  const [showReservationSuccess, setShowReservationSuccess] = useState(false);

  const canLoadSlots = date && fieldType && fieldType !== 'all';

  // Numéro Sénégal : 9 chiffres, commençant par 7 ou 3 (ex. 77 123 45 67)
  const PHONE_PREFIX = '+221';
  const isValidPhone = (digits) => /^[37]\d{8}$/.test(digits) && digits.length === 9;

  const handlePhoneChange = (e) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
    setPhone(digits);
    setPhoneError('');
  };

  const validatePhone = () => {
    if (!phone) {
      setPhoneError('');
      return false;
    }
    if (!isValidPhone(phone)) {
      setPhoneError('Numéro invalide. 9 chiffres attendus (ex. 77 123 45 67).');
      return false;
    }
    setPhoneError('');
    return true;
  };

  const fetchAvailability = async () => {
    if (!canLoadSlots) return;
    try {
      setLoadingSlots(true);
      const params = new URLSearchParams({
        date,
        type: fieldType,
      });
      const res = await fetch(
        `${API_BASE_URL}/reservations/availability?${params.toString()}`
      );
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error('Réponse du serveur invalide. Vérifiez que l’API tourne sur ' + (API_BASE_URL.replace(/\/api$/, '')));
      }
      if (!res.ok) {
        throw new Error(data.message || `Erreur ${res.status}`);
      }
      setAvailableSlots(Array.isArray(data) ? data : []);
      setSelectedSlot(null);
      setSelectedField(null);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Impossible de charger les créneaux disponibles. Vérifiez que le backend tourne sur le port 5000.');
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    if (canLoadSlots) {
      fetchAvailability();
    } else {
      setAvailableSlots([]);
      setSelectedSlot(null);
      setSelectedField(null);
    }
    setStep('slots');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, fieldType]);

  const handlePay = async (paymentMethod) => {
    if (!selectedSlot) return;
    if (!name || !phone) {
      alert('Veuillez renseigner votre nom et votre numéro de téléphone.');
      return;
    }
    if (!validatePhone()) return;

    const fullPhone = `${PHONE_PREFIX}${phone}`;
    try {
      setSubmitting(true);
      const res = await fetch(`${API_BASE_URL}/reservations/public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldId: selectedSlot.fieldId,
          date,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          name,
          email,
          phone: fullPhone,
          address,
          paymentMethod,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur de réservation');

      setDate('');
      setAvailableSlots([]);
      setSelectedSlot(null);
      setSelectedField(null);
      setName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setStep('slots');
      onReservationCreated();
      setShowReservationSuccess(true);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="layout-two-columns">
      <section className="panel reservation-panel">
        {step === 'slots' && (
          <>
            <h2>Réserver un créneau</h2>
            <p className="panel-subtitle">
              Sélectionnez une date et un format de terrain. Tous les créneaux disponibles vont
              s&apos;afficher automatiquement.
            </p>

            <div className="form-grid">
              <label className="form-field">
                <span>Format du terrain</span>
                <select
                  value={fieldType}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFieldType(value);
                    setSelectedField(null);
                  }}
                >
                  <option value="all">Choisir un format</option>
                  <option value="5">Terrain à 5</option>
                  <option value="11">Terrain à 11</option>
                </select>
              </label>
              <label className="form-field">
                <span>Date</span>
                <input
                  type="date"
                  value={date}
                  min={TODAY_STR}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
            </div>

            {error && <p className="panel-error">{error}</p>}

            <div className="field-list">
              {loading || loadingSlots ? (
                <p className="empty-state">Chargement des créneaux disponibles...</p>
              ) : canLoadSlots && !availableSlots.length ? (
                <p className="empty-state">
                  Aucun créneau disponible pour cette date et ce format pour le moment.
                </p>
              ) : (
                availableSlots.map((slot) => (
                  <button
                    key={`${slot.fieldId}-${slot.startTime}-${slot.endTime}`}
                    type="button"
                    className={
                      selectedSlot &&
                      selectedSlot.fieldId === slot.fieldId &&
                      selectedSlot.startTime === slot.startTime &&
                      selectedSlot.endTime === slot.endTime
                        ? 'field-card selected'
                        : 'field-card'
                    }
                    onClick={() => {
                      setSelectedSlot(slot);
                      setSelectedField({
                        _id: slot.fieldId,
                        name: slot.fieldName,
                        type: slot.type,
                        pricePerHour: slot.pricePerHour,
                      });
                    }}
                  >
                    <div className="field-type">
                      {slot.startTime} – {slot.endTime}
                    </div>
                    <div className="field-name">{slot.fieldName}</div>
                    <div className="field-meta">
                      <span>Terrain à {slot.type}</span>
                      <span>{slot.pricePerHour} FCFA / heure</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {selectedSlot && (
              <div className="reservation-form">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setStep('info')}
                >
                  Continuer avec ce créneau
                </button>
              </div>
            )}
          </>
        )}

        {step === 'info' && selectedSlot && (
          <>
            <div className="slot-recap">
              <h3 className="slot-recap-title">Créneau sélectionné</h3>
              <div className="slot-recap-row">
                <span className="slot-recap-label">Date</span>
                <span className="slot-recap-value">
                  {new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <div className="slot-recap-row">
                <span className="slot-recap-label">Horaire</span>
                <span className="slot-recap-value">
                  {selectedSlot.startTime} – {selectedSlot.endTime}
                </span>
              </div>
              <div className="slot-recap-row">
                <span className="slot-recap-label">Terrain</span>
                <span className="slot-recap-value">
                  {selectedField?.name || selectedSlot.fieldName} (terrain à {selectedSlot.type})
                </span>
              </div>
              <div className="slot-recap-row slot-recap-price">
                <span className="slot-recap-label">Montant</span>
                <span className="slot-recap-value">{selectedSlot.pricePerHour} FCFA</span>
              </div>
              <button
                type="button"
                className="ghost-button small"
                onClick={() => setStep('slots')}
              >
                Changer de créneau
              </button>
            </div>

            <h2 className="form-section-title">Vos informations</h2>
            <p className="panel-subtitle">
              Renseignez vos coordonnées, puis choisissez votre moyen de paiement (Wave ou Orange
              Money). Votre réservation sera enregistrée et prise en compte.
            </p>

            <div className="reservation-form">
              <label className="form-field">
                <span>Nom complet</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom et prénom"
                />
              </label>
              <label className="form-field">
                <span>Numéro de téléphone</span>
                <div className={`phone-input-wrap ${phoneError ? 'input-error' : ''}`}>
                  <span className="phone-prefix">{PHONE_PREFIX}</span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={handlePhoneChange}
                    onBlur={validatePhone}
                    placeholder="77 123 45 67"
                    maxLength={9}
                  />
                </div>
                {phoneError && <p className="field-error">{phoneError}</p>}
              </label>
              <label className="form-field">
                <span>Email (optionnel)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemple@mail.com"
                />
              </label>
              <label className="form-field">
                <span>Adresse (optionnel)</span>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Quartier, ville"
                />
              </label>

              {name.trim() && isValidPhone(phone) ? (
                <>
                  <p className="payment-choice-label">Choisir le moyen de paiement</p>
                  <div className="payment-buttons">
                    <button
                      type="button"
                      className="payment-btn payment-btn-wave"
                      disabled={submitting}
                      onClick={() => handlePay('wave')}
                    >
                      {submitting ? 'Envoi...' : 'Payer avec Wave'}
                    </button>
                    <button
                      type="button"
                      className="payment-btn payment-btn-orange"
                      disabled={submitting}
                      onClick={() => handlePay('orange_money')}
                    >
                      {submitting ? 'Envoi...' : 'Payer avec Orange Money'}
                    </button>
                  </div>
                  <p className="hint">
                    En cliquant sur Wave ou Orange Money, votre réservation est enregistrée. Vous
                    serez contacté pour finaliser le paiement.
                  </p>
                </>
              ) : (
                <p className="hint">
                  Renseignez au moins votre <strong>nom</strong> et votre <strong>numéro de
                  téléphone</strong> pour afficher les options de paiement.
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section className="hero hero-section">
        <p className="eyebrow">Bargny · Dakar</p>
        <h1>Réservez votre terrain synthétique en quelques clics.</h1>
        <p className="hero-subtitle">
          Choisissez votre créneau, votre type de terrain (5 / 7 / 11) et profitez d&apos;une pelouse
          de qualité pour vos matchs entre amis, tournois ou entraînements.
        </p>
        <div className="hero-actions">
          <button className="primary-button" onClick={() => fetchFields(fieldType)}>
            Voir les terrains
          </button>
          <button className="ghost-button">Découvrir les services</button>
        </div>
        <div className="hero-highlights">
          <div>
            <span className="highlight-number">09h - 02h</span>
            <span className="highlight-label">Ouvert tous les jours</span>
          </div>
          <div>
            <span className="highlight-number">+10k</span>
            <span className="highlight-label">Heures de jeu par an</span>
          </div>
          <div>
            <span className="highlight-number">10%</span>
            <span className="highlight-label">Réduction fidélité</span>
          </div>
        </div>
      </section>

      {showReservationSuccess && (
        <div className="modal-backdrop" onClick={() => setShowReservationSuccess(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Réservation prise en compte</h3>
            <p className="hint">
              Votre réservation a bien été enregistrée. Vous serez contacté pour finaliser le
              paiement (Wave ou Orange Money).
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => setShowReservationSuccess(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AuthPanel({ apiBase, onAuthSuccess }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data?.message || 'Erreur de connexion');
      onAuthSuccess(data);
    } catch (err) {
      console.error(err);
      setError(err.message || "Impossible de joindre le serveur. Vérifiez l'URL de l'API.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <h2>Espace gestionnaire</h2>
        <p className="auth-subtitle">
          Connectez-vous avec votre compte administrateur pour gérer les terrains et les
          réservations.
        </p>

        {error && <p className="panel-error">{error}</p>}

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="form-field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </label>
          <label className="form-field">
            <span>Mot de passe</span>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="hint">
          Utilisez le compte admin fourni (après avoir lancé <code>npm run seed</code> dans le
          backend : admin@samaterrain.sn / admin123).
        </p>
      </div>
    </div>
  );
}

function AdminDashboard({ apiBase, token, onLogout, user }) {
  const [fields, setFields] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [loadingReservations, setLoadingReservations] = useState(true);
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: '5',
    pricePerHour: 30000,
  });
  const [saving, setSaving] = useState(false);

  // Réservation pour un client (par téléphone)
  const [adminType, setAdminType] = useState('11');
  const [adminDate, setAdminDate] = useState('');
  const [adminSlots, setAdminSlots] = useState([]);
  const [adminLoadingSlots, setAdminLoadingSlots] = useState(false);
  const [adminSelectedSlot, setAdminSelectedSlot] = useState(null);
  const [adminName, setAdminName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminAddress, setAdminAddress] = useState('');
  const [adminSaving, setAdminSaving] = useState(false);
  // 'all' = vue globale, sinon onglet spécifique
  const [adminTab, setAdminTab] = useState('all'); // 'all' | 'terrain' | 'users' | 'creneaux' | 'reservations'
  const [paymentModal, setPaymentModal] = useState(null); // { id, totalPrice, label }
  const [paymentModalMethod, setPaymentModalMethod] = useState('wave');
  const [paymentModalMode, setPaymentModalMode] = useState('full'); // 'full' | 'half'
  // Filtres de recherche pour les réservations
  const [reservationFilterType, setReservationFilterType] = useState('all');
  const [reservationFilterDate, setReservationFilterDate] = useState('');

  // Gestion des utilisateurs (gestionnaires)
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [gestionnaireForm, setGestionnaireForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [savingGestionnaire, setSavingGestionnaire] = useState(false);
  const [userMessage, setUserMessage] = useState({ type: '', text: '' });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const fetchFields = async () => {
    setLoadingFields(true);
    try {
      const res = await fetch(`${apiBase}/fields`, { headers: authHeaders() });
      const data = res.ok ? await res.json() : [];
      setFields(Array.isArray(data) ? data : []);
    } catch {
      setFields([]);
    } finally {
      setLoadingFields(false);
    }
  };

  const fetchReservations = async () => {
    setLoadingReservations(true);
    try {
      const res = await fetch(`${apiBase}/reservations`, { headers: authHeaders() });
      const data = res.ok ? await res.json() : [];
      setReservations(Array.isArray(data) ? data : []);
    } catch {
      setReservations([]);
    } finally {
      setLoadingReservations(false);
    }
  };

  const filteredReservations = reservations.filter((r) => {
    // Filtre par type de terrain
    if (reservationFilterType !== 'all') {
      const fieldType = r.field?.type ? String(r.field.type) : '';
      if (fieldType !== reservationFilterType) return false;
    }
    // Filtre par date (jour)
    if (reservationFilterDate) {
      const reservationDateStr = new Date(r.date).toISOString().slice(0, 10);
      if (reservationDateStr !== reservationFilterDate) return false;
    }
    return true;
  });

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch(`${apiBase}/auth/users`, { headers: authHeaders() });
      const data = res.ok ? await res.json() : [];
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchFields();
    fetchReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token]);

  useEffect(() => {
    if ((adminTab === 'users' || adminTab === 'all') && user?.role === 'admin') fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminTab, user?.role]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleCreateField = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await fetch(`${apiBase}/fields`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ...form, pricePerHour: Number(form.pricePerHour) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Erreur création terrain');
      }
      setForm({ name: '', description: '', type: '5', pricePerHour: 30000 });
      fetchFields();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCreateGestionnaire = async (e) => {
    e.preventDefault();
    const { name, email, phone, password } = gestionnaireForm;
    if (!name?.trim() || !email?.trim() || !password) {
      setUserMessage({ type: 'error', text: 'Nom, email et mot de passe sont requis.' });
      return;
    }
    setUserMessage({ type: '', text: '' });
    setSavingGestionnaire(true);
    try {
      const res = await fetch(`${apiBase}/auth/create-gestionnaire`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone?.trim() || undefined, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur lors de la création');
      setGestionnaireForm({ name: '', email: '', phone: '', password: '' });
      setUserMessage({ type: 'success', text: 'Gestionnaire créé avec succès.' });
      fetchUsers();
    } catch (err) {
      setUserMessage({ type: 'error', text: err.message || 'Erreur lors de la création du gestionnaire.' });
    } finally {
      setSavingGestionnaire(false);
    }
  };

  const handleDeleteField = async (fieldId) => {
    if (!confirm('Supprimer ce terrain ? Les réservations associées resteront en base.')) return;
    try {
      const res = await fetch(`${apiBase}/fields/${fieldId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) fetchFields();
      else {
        const data = await res.json();
        alert(data.message || 'Impossible de supprimer');
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const updateReservation = async (id, patch) => {
    try {
      const res = await fetch(`${apiBase}/reservations/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur mise à jour réservation');
      fetchReservations();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  const fetchAdminSlots = async () => {
    if (!adminDate || !adminType) return;
    setAdminLoadingSlots(true);
    try {
      const params = new URLSearchParams({ date: adminDate, type: adminType });
      const res = await fetch(`${apiBase}/reservations/availability?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur chargement créneaux');
      setAdminSlots(Array.isArray(data) ? data : []);
      setAdminSelectedSlot(null);
    } catch (err) {
      console.error(err);
      alert(err.message);
      setAdminSlots([]);
      setAdminSelectedSlot(null);
    } finally {
      setAdminLoadingSlots(false);
    }
  };

  const handleAdminCreate = async (e) => {
    e.preventDefault();
    if (!adminSelectedSlot) {
      alert('Choisissez un créneau.');
      return;
    }
    if (!adminName || !adminPhone) {
      alert('Renseignez au minimum le nom et le téléphone du client.');
      return;
    }
    try {
      setAdminSaving(true);
      const res = await fetch(`${apiBase}/reservations/admin-create`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          fieldId: adminSelectedSlot.fieldId,
          date: adminDate,
          startTime: adminSelectedSlot.startTime,
          endTime: adminSelectedSlot.endTime,
          name: adminName,
          email: adminEmail,
          phone: adminPhone,
          address: adminAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur lors de la création de la réservation');

      setAdminName('');
      setAdminPhone('');
      setAdminEmail('');
      setAdminAddress('');
      setAdminSelectedSlot(null);
      fetchReservations();
      fetchAdminSlots();
      alert('Réservation créée pour le client.');
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setAdminSaving(false);
    }
  };

  return (
    <div className="admin-layout">
      <div className="admin-nav">
        <button
          type="button"
          className={adminTab === 'all' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setAdminTab('all')}
        >
          Vue globale
        </button>
        {user?.role === 'admin' && (
          <>
            <button
              type="button"
              className={adminTab === 'terrain' ? 'admin-tab active' : 'admin-tab'}
              onClick={() => setAdminTab('terrain')}
            >
              Gestion terrains
            </button>
            <button
              type="button"
              className={adminTab === 'users' ? 'admin-tab active' : 'admin-tab'}
              onClick={() => setAdminTab('users')}
            >
              Gestion utilisateurs
            </button>
          </>
        )}
        <button
          type="button"
          className={adminTab === 'creneaux' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setAdminTab('creneaux')}
        >
          Gestion créneaux
        </button>
        <button
          type="button"
          className={adminTab === 'reservations' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setAdminTab('reservations')}
        >
          Réservations
        </button>
      </div>

      

      {(adminTab === 'reservations' || adminTab === 'all') && (
      <section className="panel">
        <div className="panel-header-row">
          <h2>Toutes les réservations</h2>
          <button type="button" className="ghost-button small" onClick={fetchReservations}>
            Actualiser
          </button>
        </div>
        <p className="panel-subtitle">
          Liste de toutes les réservations (clients et créneaux). Utilisez les filtres pour affiner.
        </p>

        <div className="form-grid" style={{ marginBottom: '0.75rem', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <label className="form-field">
            <span>Type de terrain</span>
            <select
              value={reservationFilterType}
              onChange={(e) => setReservationFilterType(e.target.value)}
            >
              <option value="all">Tous les formats</option>
              <option value="5">Terrain à 5</option>
              <option value="7">Terrain à 7</option>
              <option value="11">Terrain à 11</option>
            </select>
          </label>
          <label className="form-field">
            <span>Date</span>
            <input
              type="date"
              value={reservationFilterDate}
              onChange={(e) => setReservationFilterDate(e.target.value)}
            />
          </label>
          <div className="form-field" style={{ alignSelf: 'flex-end' }}>
            {(reservationFilterType !== 'all' || reservationFilterDate) && (
              <button
                type="button"
                className="ghost-button small"
                onClick={() => {
                  setReservationFilterType('all');
                  setReservationFilterDate('');
                }}
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </div>

        <div className="reservation-list">
          {loadingReservations ? (
            <p className="empty-state">Chargement...</p>
          ) : (
            filteredReservations.map((r) => (
              <div key={r._id} className={`reservation-row${r.status === 'cancelled' ? ' reservation-row-cancelled' : ''}`}>
                <div className="reservation-main">
                  <span className="reservation-title">
                    {new Date(r.date).toLocaleDateString('fr-FR')} · {r.startTime} – {r.endTime}
                  </span>
                  <span className="reservation-subtitle">
                    {r.field?.name || 'Terrain'} (à {r.field?.type || '?'}) ·{' '}
                    {r.customerName || r.user?.name || '—'} · {r.customerPhone || r.user?.phone || '—'}
                  </span>
                </div>
                <div className="reservation-meta">
                  <span className="badge">{r.paymentStatus || r.status}</span>
                  <span className="reservation-price">{r.totalPrice} FCFA</span>
                  {r.status === 'cancelled' ? null : (
                    <div className="reservation-actions">
                      <select
                        className="reservation-method"
                        value={r.paymentMethod || ''}
                        onChange={async (e) => {
                          const value = e.target.value || null;
                          try {
                            await updateReservation(r._id, { paymentMethod: value });
                          } catch (err) {
                            alert(err.message);
                          }
                        }}
                      >
                        <option value="">Moyen de paiement</option>
                        <option value="wave">Wave</option>
                        <option value="orange_money">Orange Money</option>
                        <option value="cash">Cash / Autre</option>
                        <option value="admin">Admin (manuel)</option>
                      </select>
                      <button
                        type="button"
                        className="ghost-button small"
                        onClick={() => updateReservation(r._id, { status: 'confirmed' })}
                        disabled={r.status === 'confirmed'}
                      >
                        Valider
                      </button>
                      {user?.role === 'admin' && (
                      <button
                        type="button"
                        className="ghost-button small danger"
                        onClick={() =>
                          updateReservation(r._id, {
                            status: 'cancelled',
                            paymentStatus: 'cancelled',
                          })
                        }
                        disabled={
                          r.paymentStatus === 'partial' || r.paymentStatus === 'paid'
                        }
                        title={
                          r.paymentStatus === 'partial' || r.paymentStatus === 'paid'
                            ? 'Impossible d’annuler : un paiement a déjà été enregistré.'
                            : undefined
                        }
                      >
                        Annuler
                      </button>
                      )}
                      <button
                        type="button"
                        className="ghost-button small"
                        onClick={() => {
                          setPaymentModal({
                            id: r._id,
                            totalPrice: r.totalPrice,
                            label: `${new Date(r.date).toLocaleDateString('fr-FR')} · ${
                              r.startTime
                            } – ${r.endTime} · ${r.field?.name || 'Terrain'}`,
                          });
                          setPaymentModalMethod(r.paymentMethod || 'wave');
                          setPaymentModalMode('full');
                        }}
                      >
                        Marquer payé
                      </button>
                      {r.paymentStatus === 'partial' && (
                        <button
                          type="button"
                          className="ghost-button small"
                          onClick={() =>
                            updateReservation(r._id, {
                              paymentStatus: 'paid',
                              paidAmount: r.totalPrice,
                            })
                          }
                          title="Marquer le solde comme payé (total)"
                        >
                          Compléter le paiement
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {!loadingReservations && !filteredReservations.length && (
            <p className="empty-state">
              Aucune réservation{reservationFilterType !== 'all' || reservationFilterDate ? ' pour ces filtres.' : '.'}
            </p>
          )}
        </div>
      </section>
      )}

      {paymentModal && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3>Marquer la réservation comme payée</h3>
            <p className="hint">{paymentModal.label}</p>

            <label className="form-field">
              <span>Moyen de paiement</span>
              <select
                value={paymentModalMethod}
                onChange={(e) => setPaymentModalMethod(e.target.value)}
              >
                <option value="wave">Wave</option>
                <option value="orange_money">Orange Money</option>
                <option value="cash">Cash / Autre</option>
                <option value="admin">Admin (manuel)</option>
              </select>
            </label>

            <div className="form-grid">
              <label className="form-field">
                <span>
                  <input
                    type="radio"
                    name="paymentMode"
                    value="full"
                    checked={paymentModalMode === 'full'}
                    onChange={() => setPaymentModalMode('full')}
                  />{' '}
                  Paiement complet
                </span>
              </label>
              <label className="form-field">
                <span>
                  <input
                    type="radio"
                    name="paymentMode"
                    value="half"
                    checked={paymentModalMode === 'half'}
                    onChange={() => setPaymentModalMode('half')}
                  />{' '}
                  Paiement moitié
                </span>
              </label>
            </div>

            <p className="hint">
              Montant enregistré :{' '}
              <strong>
                {paymentModalMode === 'half'
                  ? Math.round(paymentModal.totalPrice / 2)
                  : paymentModal.totalPrice}{' '}
                FCFA
              </strong>
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button small"
                onClick={() => setPaymentModal(null)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={async () => {
                  if (!paymentModal) return;
                  const paidAmount =
                    paymentModalMode === 'half'
                      ? Math.round(paymentModal.totalPrice / 2)
                      : paymentModal.totalPrice;
                  const paymentStatus = paymentModalMode === 'half' ? 'partial' : 'paid';
                  await updateReservation(paymentModal.id, {
                    paymentMethod: paymentModalMethod,
                    paymentStatus,
                    paidAmount,
                  });
                  setPaymentModal(null);
                }}
              >
                Valider le paiement
              </button>
            </div>
          </div>
        </div>
      )}
      {(adminTab === 'creneaux' || adminTab === 'all') && (
      <section className="panel admin-booking-panel">
        <h2>Réserver un créneau pour un client (téléphone)</h2>
        <p className="panel-subtitle">
          Choisissez un terrain, une date et un créneau disponible, puis saisissez les coordonnées du
          client pour enregistrer la réservation.
        </p>

        <form className="reservation-form" onSubmit={handleAdminCreate}>
          <div className="form-grid">
            <label className="form-field">
              <span>Format du terrain</span>
              <select
                value={adminType}
                onChange={(e) => {
                  setAdminType(e.target.value);
                  setAdminSlots([]);
                  setAdminSelectedSlot(null);
                }}
              >
                <option value="5">Terrain à 5 (créneaux 1h)</option>
                <option value="11">Terrain à 11 (créneaux 2h)</option>
              </select>
            </label>
            <label className="form-field">
              <span>Date</span>
              <input
                type="date"
                value={adminDate}
                  min={TODAY_STR}
                onChange={(e) => {
                  setAdminDate(e.target.value);
                  setAdminSlots([]);
                  setAdminSelectedSlot(null);
                }}
                required
              />
            </label>
          </div>

          <button
            type="button"
            className="ghost-button small"
            onClick={fetchAdminSlots}
            disabled={!adminDate || !adminType || adminLoadingSlots}
          >
            {adminLoadingSlots ? 'Chargement des créneaux...' : 'Charger les créneaux disponibles'}
          </button>

          <div className="field-list">
            {adminSlots.map((slot) => (
              <button
                key={`${slot.fieldId}-${slot.startTime}-${slot.endTime}`}
                type="button"
                className={
                  adminSelectedSlot &&
                  adminSelectedSlot.fieldId === slot.fieldId &&
                  adminSelectedSlot.startTime === slot.startTime &&
                  adminSelectedSlot.endTime === slot.endTime
                    ? 'field-card selected'
                    : 'field-card'
                }
                onClick={() => setAdminSelectedSlot(slot)}
              >
                <div className="field-type">
                  {slot.startTime} – {slot.endTime}
                </div>
                <div className="field-name">{slot.fieldName}</div>
                <div className="field-meta">
                  <span>Terrain à {slot.type}</span>
                  <span>{slot.pricePerHour} FCFA / heure</span>
                </div>
              </button>
            ))}
            {!adminLoadingSlots && adminDate && !adminSlots.length && (
              <p className="empty-state">Aucun créneau disponible pour cette date / ce format.</p>
            )}
          </div>

          {adminSelectedSlot && (
            <>
              <p className="hint">
                Créneau choisi : {adminSelectedSlot.startTime} – {adminSelectedSlot.endTime} ·{' '}
                {adminSelectedSlot.fieldName} (terrain à {adminSelectedSlot.type})
              </p>
              <label className="form-field">
                <span>Nom complet du client</span>
                <input
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                <span>Téléphone du client</span>
                <input
                  value={adminPhone}
                  onChange={(e) => setAdminPhone(e.target.value)}
                  required
                />
              </label>
              <label className="form-field">
                <span>Email du client (optionnel)</span>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Adresse du client (optionnel)</span>
                <input
                  value={adminAddress}
                  onChange={(e) => setAdminAddress(e.target.value)}
                />
              </label>
              <button className="primary-button" type="submit" disabled={adminSaving}>
                {adminSaving ? 'Enregistrement...' : 'Créer la réservation pour le client'}
              </button>
            </>
          )}
        </form>
      </section>
      )}
      {(adminTab === 'terrain' || adminTab === 'all') && user?.role === 'admin' && (
      <section className="panel">
        <h2>Gestion des terrains (créneaux)</h2>
        <p className="panel-subtitle">
          Ajoutez, modifiez ou supprimez les terrains. Ils définissent les créneaux disponibles sur
          la page publique.
        </p>

        <form className="reservation-form" onSubmit={handleCreateField}>
          <label className="form-field">
            <span>Nom du terrain</span>
            <input name="name" value={form.name} onChange={handleChange} required />
          </label>
          <label className="form-field">
            <span>Description</span>
            <textarea name="description" value={form.description} onChange={handleChange} rows={2} />
          </label>
          <div className="form-grid">
            <label className="form-field">
              <span>Type</span>
              <select name="type" value={form.type} onChange={handleChange}>
                <option value="5">Terrain à 5</option>
                <option value="7">Terrain à 7</option>
                <option value="11">Terrain à 11</option>
              </select>
            </label>
            <label className="form-field">
              <span>Prix / heure (FCFA)</span>
              <input
                type="number"
                name="pricePerHour"
                value={form.pricePerHour}
                onChange={handleChange}
              />
            </label>
          </div>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Enregistrement...' : 'Ajouter le terrain'}
          </button>
        </form>

        <div className="field-list condensed">
          {loadingFields ? (
            <p className="empty-state">Chargement...</p>
          ) : (
            fields.map((field) => (
              <div key={field._id} className="field-card field-card-admin">
                <div>
                  <div className="field-type">Terrain à {field.type}</div>
                  <div className="field-name">{field.name}</div>
                  <div className="field-meta">
                    <span>{field.pricePerHour} FCFA / heure</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="ghost-button small danger"
                  onClick={() => handleDeleteField(field._id)}
                  title="Supprimer le terrain"
                >
                  Supprimer
                </button>
              </div>
            ))
          )}
          {!loadingFields && !fields.length && (
            <p className="empty-state">Aucun terrain. Lancez le seed ou ajoutez-en un ci-dessus.</p>
          )}
        </div>
      </section>
      )}

     

      {(adminTab === 'users' || adminTab === 'all') && user?.role === 'admin' && (
        <section className="panel">
          <h2>Gestion des utilisateurs</h2>
          <p className="panel-subtitle">
            Créez des comptes gestionnaires. Les gestionnaires peuvent gérer les créneaux et valider les réservations (sans pouvoir annuler ni gérer les terrains).
          </p>

          <form onSubmit={handleCreateGestionnaire} className="form-card" style={{ marginBottom: '1.5rem' }}>
            <h3>Nouveau gestionnaire</h3>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="form-field">
                <span>Nom</span>
                <input
                  type="text"
                  value={gestionnaireForm.name}
                  onChange={(e) => setGestionnaireForm({ ...gestionnaireForm, name: e.target.value })}
                  placeholder="Nom du gestionnaire"
                  required
                />
              </label>
              <label className="form-field">
                <span>Email</span>
                <input
                  type="email"
                  value={gestionnaireForm.email}
                  onChange={(e) => setGestionnaireForm({ ...gestionnaireForm, email: e.target.value })}
                  placeholder="email@exemple.sn"
                  required
                />
              </label>
              <label className="form-field">
                <span>Téléphone (optionnel)</span>
                <input
                  type="text"
                  value={gestionnaireForm.phone}
                  onChange={(e) => setGestionnaireForm({ ...gestionnaireForm, phone: e.target.value })}
                  placeholder="+221 77 123 45 67"
                />
              </label>
              <label className="form-field">
                <span>Mot de passe</span>
                <input
                  type="password"
                  value={gestionnaireForm.password}
                  onChange={(e) => setGestionnaireForm({ ...gestionnaireForm, password: e.target.value })}
                  placeholder="Mot de passe de connexion"
                  required
                  minLength={6}
                />
              </label>
            </div>
            {userMessage.text && (
              <p className={userMessage.type === 'success' ? 'hint' : 'toast toast-error'} style={{ marginTop: '0.5rem' }}>
                {userMessage.text}
              </p>
            )}
            <button type="submit" className="primary-button" disabled={savingGestionnaire} style={{ marginTop: '0.75rem' }}>
              {savingGestionnaire ? 'Création…' : 'Créer le gestionnaire'}
            </button>
          </form>

          <h3>Administrateurs et gestionnaires</h3>
          {loadingUsers ? (
            <p className="empty-state">Chargement…</p>
          ) : (
            <div className="reservation-list">
              {users.filter((u) => u.role === 'admin' || u.role === 'gestionnaire').map((u) => (
                <div key={u._id} className="reservation-row">
                  <div className="reservation-main">
                    <span className="reservation-title">{u.name}</span>
                    <span className="reservation-subtitle">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span>
                  </div>
                  <div className="reservation-meta">
                    <span className="badge">{u.role === 'admin' ? 'Admin' : 'Gestionnaire'}</span>
                  </div>
                </div>
              ))}
              {!users.filter((u) => u.role === 'admin' || u.role === 'gestionnaire').length && (
                <p className="empty-state">Aucun administrateur ou gestionnaire.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default App;
