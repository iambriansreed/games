const ERRORS: Record<string, string> = {
    auth_state: 'Sign-in expired. Please try again.',
    auth_failed: 'Sign-in failed. Please try again.',
    auth_unverified: 'Your Google email is not verified.',
    access_denied: 'That account is not allowed.',
};

export function Login() {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    return (
        <div className="login">
            <div className="login-card">
                <h1 className="login-title">Games</h1>
                <p className="login-sub">Multiplayer board games with friends.</p>
                {error && <p className="login-error">{ERRORS[error] || 'Sign-in error.'}</p>}
                <a className="btn btn-primary login-google" href="/api/auth/google">
                    Continue with Google
                </a>
            </div>
        </div>
    );
}
