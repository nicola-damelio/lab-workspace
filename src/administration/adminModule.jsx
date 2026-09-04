/* =========================================================================
   src/administration/adminModule.jsx
   Module Administration : chaque base d’administration est un dataset de
   type « administration » (payload `administration` dans datasets/<id>).
   La navigation se fait par la barre latérale principale (pages d’admin
   affichées comme les modules scientifiques) : l’état de la page active
   (pageId/onNavigate) est détenu par App.jsx.
   ========================================================================= */
import { ADMIN_PAGES } from './adminSchema';
import { AdminProvider, useAdmin } from './AdminContext';
import { normalizeOperators } from '../utils/auth';
import { RecettesPage } from './recettesPage';
import { PersonnelPage } from './personnelPage';
import { SettingsPage } from './settingsPage';

export const AdministrationModule = ({
  currentUser, user, datasetTitle, saveStatus, content, onChange,
  pageId,
  operators, setOperators, authSettings, setAuthSettings,
  onRequestLogin,
}) => {
  const team = normalizeOperators(operators || []);
  // Bootstrap : aucun compte scientifique OU aucun superutilisateur n’est
  // encore défini → la base reste accessible (comme le reste de l’app) pour
  // permettre de créer le superutilisateur dans la page Paramètres.
  const teamBootstrap = team.length === 0 || !team.some((op) => op.role === 'superuser');
  const needLogin = !currentUser && !teamBootstrap;

  if (needLogin) {
    return <LoginRequiredCard onRequestLogin={onRequestLogin} />;
  }

  return (
    <AdminProvider
      currentUser={currentUser} user={user} content={content} onChange={onChange}
      teamBootstrap={teamBootstrap}
    >
      <AdministrationShell
        datasetTitle={datasetTitle} saveStatus={saveStatus}
        pageId={pageId}
        currentUser={currentUser}
        operators={operators} setOperators={setOperators}
        authSettings={authSettings} setAuthSettings={setAuthSettings}
      />
    </AdminProvider>
  );
};

const LoginRequiredCard = ({ onRequestLogin }) => (
  <div className="h-full min-h-0 overflow-y-auto bg-slate-50 p-4 md:p-6 flex items-center justify-center">
    <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
      <div className="text-5xl mb-3">🔐</div>
      <h2 className="text-lg font-black text-slate-800 mb-1">Connexion requise</h2>
      <p className="text-sm text-slate-500 mb-5">
        Cette base d’administration est partagée avec l’équipe du laboratoire.
        Connectez-vous en tant que scientifique pour l’ouvrir ; un superutilisateur
        peut créer votre compte dans la page Paramètres.
      </p>
      {typeof onRequestLogin === 'function' && (
        <button
          onClick={onRequestLogin}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-2.5 rounded-xl shadow-sm transition-colors"
        >
          Se connecter…
        </button>
      )}
    </div>
  </div>
);

/* ── Coquille : en-tête + contenu de la page active (navigation = sidebar) ─ */
const AdministrationShell = ({
  datasetTitle, saveStatus, pageId,
  currentUser, operators, setOperators, authSettings, setAuthSettings,
}) => {
  const { data, ready, access } = useAdmin();
  const visible = ADMIN_PAGES.filter((p) => access.canViewPage(p));
  const requested = ADMIN_PAGES.find((p) => p.id === pageId) || ADMIN_PAGES[0];
  const active = visible.find((p) => p.id === requested.id) || visible[0];

  return (
    <div className="h-full min-h-0 flex flex-col bg-slate-50">
      <div className="shrink-0 bg-white border-b border-slate-200 px-4 md:px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <span className="text-xl" aria-hidden="true">🏛️</span>
              <span className="truncate">{datasetTitle || 'Base d’administration'}</span>
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 -mt-0.5">
              {active.label} · base d’administration (dataset unique)
            </p>
          </div>
          <SaveBadge status={saveStatus} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6">
        {!ready ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm">Chargement des données…</div>
        ) : active.id === 'overview' ? (
          <OverviewPage visible={visible} />
        ) : active.id === 'recettes' ? (
          <RecettesPage />
        ) : active.id === 'personnel' ? (
          <PersonnelPage />
        ) : active.id === 'settings' ? (
          <SettingsPage
            operators={operators} setOperators={setOperators}
            authSettings={authSettings} setAuthSettings={setAuthSettings}
            currentUser={currentUser}
          />
        ) : active.kind ? (
          <PageScaffold page={active} count={(data[active.kind] || []).length} />
        ) : (
          <PageScaffold page={active} count={null} />
        )}
      </div>
    </div>
  );
};

/* ── En-tête de sauvegarde ──────────────────────────────────────────────── */
const SaveBadge = ({ status }) => {
  if (status === 'saving') {
    return <span className="text-[10px] font-black uppercase text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1 animate-pulse">Sauvegarde…</span>;
  }
  if (status === 'saved') {
    return <span className="text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">✓ Enregistré</span>;
  }
  if (status === 'error') {
    return <span className="text-[10px] font-black uppercase text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">✕ Sauvegarde impossible</span>;
  }
  return <span className="text-[10px] font-black uppercase text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">💾 Sauvegarde auto</span>;
};

/* ── Page « Vue d’ensemble » ────────────────────────────────────────────── */
const OverviewPage = ({ visible }) => {
  const { data, access } = useAdmin();
  const kindPages = visible.filter((p) => p.kind);
  const hidden = ADMIN_PAGES.filter((p) => !access.canViewPage(p));
  const totalRecettes = Array.isArray(data.recettes) ? data.recettes.length : 0;
  const totalDepenses = Array.isArray(data.depenses) ? data.depenses.length : 0;
  const totalOm = Array.isArray(data.om) ? data.om.length : 0;
  const totalDesiderate = Array.isArray(data.desiderate) ? data.desiderate.length : 0;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
        <h2 className="text-xl font-black text-slate-800 mb-1">Vue d’ensemble</h2>
        <p className="text-sm text-slate-500">
          Utilisez la barre latérale pour naviguer entre les pages (comme dans un dataset scientifique).
          Les lignes budgétaires (Recettes), le Personnel, les Paramètres d’équipe sont maintenant éditables.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {kindPages.map((p) => (
          <div key={p.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-start gap-3">
            <span className="text-2xl" aria-hidden="true">{p.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-black text-slate-700 text-sm truncate">{p.label}</h3>
                <span className="text-xl font-black text-blue-700">{(data[p.kind] || []).length}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug line-clamp-2 mt-0.5">{p.blurb}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
          <div className="text-[10px] font-black uppercase text-blue-700">Lignes budgétaires</div>
          <div className="text-2xl font-black text-blue-800">{totalRecettes}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <div className="text-[10px] font-black uppercase text-amber-700">Dépenses / BC</div>
          <div className="text-2xl font-black text-amber-800">{totalDepenses}</div>
        </div>
        <div className="bg-violet-50 border border-violet-200 rounded-2xl px-4 py-3">
          <div className="text-[10px] font-black uppercase text-violet-700">Ordres de mission</div>
          <div className="text-2xl font-black text-violet-800">{totalOm}</div>
        </div>
        <div className="bg-teal-50 border border-teal-200 rounded-2xl px-4 py-3">
          <div className="text-[10px] font-black uppercase text-teal-700">Spese Desiderate</div>
          <div className="text-2xl font-black text-teal-800">{totalDesiderate}</div>
        </div>
      </div>

      {hidden.length > 0 && (
        <p className="text-[11px] text-slate-400">
          Pages masquées pour votre rôle : {hidden.map((p) => p.label).join(' · ')} — visibles pour le superutilisateur.
        </p>
      )}
    </div>
  );
};

/* ── Échafaudage des pages non encore éditables ─────────────────────────── */
const PageScaffold = ({ page, count }) => (
  <div className="max-w-5xl mx-auto flex flex-col gap-4">
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-3xl shrink-0" aria-hidden="true">{page.icon}</span>
          <div>
            <h2 className="text-xl font-black text-slate-800">{page.label}</h2>
            <p className="text-sm text-slate-500 max-w-xl">{page.blurb}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-black text-blue-700">{count ?? '—'}</div>
          <div className="text-[10px] font-bold uppercase text-slate-400">enregistrements</div>
        </div>
      </div>
    </div>

    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 md:p-6">
      <h3 className="text-xs font-black uppercase text-slate-400 tracking-wide mb-3">Modèle de données prévu</h3>
      <div className="flex flex-wrap gap-2">
        {page.fields.map((f) => (
          <span key={f} className="bg-slate-50 border border-slate-200 text-slate-600 rounded-lg px-2.5 py-1.5 text-xs font-semibold">{f}</span>
        ))}
      </div>
      <p className="mt-5 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
        Contenu enregistré automatiquement dans cette base (datasets/&lt;id&gt;, payload `administration`).
        L’éditeur complet de cette page arrive dans une prochaine étape.
      </p>
    </div>
  </div>
);

