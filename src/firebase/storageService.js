import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { storage, db } from './config';

/**
 * Upload an STL file to Firebase Storage and return its download URL.
 * @param {string} userId
 * @param {File} file
 * @param {string} folder - 'original' | 'optimized'
 * @returns {Promise<string>} download URL
 */
export const uploadSTL = async (userId, file, folder = 'original') => {
  const storageRef = ref(storage, `stl/${userId}/${folder}/${Date.now()}_${file.name}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
};

/**
 * Save optimization metadata to Firestore.
 */
export const saveOptimizationRecord = async ({
  userId,
  originalFileURL,
  optimizedFileURL,
}) => {
  const docRef = await addDoc(collection(db, 'optimizations'), {
    userId,
    originalFileURL,
    optimizedFileURL,
    timestamp: serverTimestamp(),
  });
  return docRef.id;
};
