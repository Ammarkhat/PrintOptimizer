export const createAuthSlice = (set) => ({
    /** undefined while Firebase auth state is still resolving */
    user: undefined,
    setUser: (user) => set({ user }, false, 'auth/setUser'),
});
