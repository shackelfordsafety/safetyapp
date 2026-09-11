import { useEffect, useState } from 'react';
import { loadModule } from '../shared/loadModule';
import './opendocs.css';

/* The "view as" control, for the one account that has it. Lives in
   Settings rather than anywhere a superintendent will ever look.

   Renders nothing at all for everybody else -- not disabled, not greyed
   out, absent. A control you cannot use is a question you have to answer
   for somebody. */
export default function ViewAsPicker() {
  const [me, setMe] = useState(null);
  const [roles, setRoles] = useState([]);
  const [current, setCurrent] = useState('');

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const mod = await loadModule(() => import('./openDocs'));
        const who = await mod.whoAmI();
        const va = await loadModule(() => import('./viewAs'));
        if (dead || !who?.is_admin) return;
        setMe(who);
        setRoles(va.VIEW_AS_ROLES);
        setCurrent(va.readViewAs());
      } catch {
        /* Signed out, or no signal. Not for this person right now. */
      }
    })();
    return () => { dead = true; };
  }, []);

  if (!me || !roles.length) return null;

  async function pick(role) {
    const va = await loadModule(() => import('./viewAs'));
    va.writeViewAs(role);
    setCurrent(role);
    /* A full reload rather than re-rendering: every screen decides what to
       show from its own copy of whoAmI, and half of them read it once at
       mount. Reloading is the only way to be sure the whole app is looking
       through the same eyes -- and this is a deliberate, occasional act by
       one person, not something in anybody's way. */
    window.location.reload();
  }

  return (
    <div className="card">
      <div className="cardHeader"><strong>View the app as somebody else</strong></div>
      <p className="helperText">
        For when somebody rings you asking where a button is. This changes what
        the app <strong>shows</strong> — which buttons and sections appear — so you can
        see the screen they are looking at.
      </p>
      <p className="helperText">
        It does <strong>not</strong> change what you can actually open. The database still
        answers to your own account, so you are seeing their screen over your own
        paperwork. Good for &ldquo;where is the button&rdquo;, not for &ldquo;what exactly is in
        his list&rdquo;.
      </p>

      <div className="viewAsGrid">
        {roles.map(r => (
          <button
            key={r.id || 'self'}
            type="button"
            className={`viewAsChoice${current === r.id ? ' active' : ''}`}
            onClick={() => pick(r.id)}
          >
            <strong>{r.label}</strong>
            <span>{r.hint}</span>
          </button>
        ))}
      </div>

      {current && (
        <div className="viewAsActive" role="status">
          <strong>You are looking at the app as {roles.find(r => r.id === current)?.label || current}.</strong>
          <span>Tap &ldquo;Myself&rdquo; above to go back to seeing everything.</span>
        </div>
      )}
    </div>
  );
}
