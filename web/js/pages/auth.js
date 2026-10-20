import { h } from '../dom.js';
import { api } from '../api.js';
import { setUser } from '../state.js';
import { link, navigate, safeNext } from '../router.js';
import { toast } from '../ui.js';

function field(id, label, attrs, hint) {
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    h('input', { id, name: id, ...attrs }),
    hint ? h('span', { class: 'hint' }, hint) : null);
}

function authForm(ctx, { mode }) {
  const isLogin = mode === 'login';
  const next = safeNext(ctx.query.next);
  const error = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn', type: 'submit', style: { width: '100%' } }, isLogin ? 'Sign in' : 'Create account');

  const form = h('form', {
    novalidate: true,
    onSubmit: async (e) => {
      e.preventDefault();
      error.textContent = '';
      const fd = new FormData(form);
      const body = Object.fromEntries(fd);
      if (!isLogin && body.password.length < 8) {
        error.textContent = 'Password must be at least 8 characters.';
        return;
      }
      submit.disabled = true;
      try {
        const { user, access } = await (isLogin ? api.login(body) : api.register(body));
        setUser(user, access);
        toast(isLogin ? `Welcome back, ${user.username}!` : `Welcome to MovieOn, ${user.username}!`);
        navigate(`#${next}`);
      } catch (err) {
        error.textContent = err.message;
      } finally {
        submit.disabled = false;
      }
    },
  },
  field('email', 'Email', { type: 'email', required: true, autocomplete: 'email', maxlength: 254 }),
  isLogin ? null : field('username', 'Display name', { type: 'text', required: true, autocomplete: 'nickname', minlength: 2, maxlength: 32 }),
  field('password', 'Password', { type: 'password', required: true, autocomplete: isLogin ? 'current-password' : 'new-password', minlength: isLogin ? null : 8, maxlength: 72 },
    isLogin ? null : 'At least 8 characters.'),
  error, submit);

  return h('div', { class: 'page-narrow' },
    h('div', { class: 'card-panel' },
      h('h1', {}, isLogin ? 'Sign in' : 'Create your account'),
      form,
      h('p', { class: 'muted', style: { marginTop: '16px', marginBottom: 0 } },
        isLogin ? 'New to MovieOn? ' : 'Already have an account? ',
        h('a', { href: link(isLogin ? '/register' : '/login', { next: next === '/' ? '' : next }), style: { textDecoration: 'underline' } },
          isLogin ? 'Create an account' : 'Sign in'))));
}

export function loginPage(ctx) {
  ctx.title('Sign in — MovieOn');
  return authForm(ctx, { mode: 'login' });
}

export function registerPage(ctx) {
  ctx.title('Create account — MovieOn');
  return authForm(ctx, { mode: 'register' });
}
