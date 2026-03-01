import { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase/config';
import useAppStore from '../store/useAppStore';

/**
 * Listens to Firebase auth state changes and syncs to global store.
 */
const useAuthListener = () => {
  const setUser = useAppStore((s) => s.setUser);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ?? null);
    });
    return unsubscribe;
  }, [setUser]);
};

export default useAuthListener;
