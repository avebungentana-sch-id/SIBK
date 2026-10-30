import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch
} from 'firebase/firestore';
import { db, auth, OperationType, handleFirestoreError } from '../firebase';
import { SchoolConfig, PointCategory, Student, PointHistoryItem, CounselingLog, AppData } from '../types';

export const DEFAULT_SCHOOL_CONFIG: SchoolConfig = {
  name: "SMA Negeri Contoh",
  address: "Jl. Pendidikan No. 1",
  teacher: "Guru BK",
  defaultScore: 100,
  alertRed: 29,
  alertOrange: 49,
  alertYellow: 70,
  starLimit: 101,
};

export const DEFAULT_CATEGORIES: PointCategory[] = [
  { id: 'cat-1', type: 'punishment', name: 'Terlambat', point: 5 },
  { id: 'cat-2', type: 'punishment', name: 'Atribut Tidak Lengkap', point: 10 },
  { id: 'cat-5', type: 'reward', name: 'Juara Lomba', point: 10 },
  { id: 'cat-6', type: 'reward', name: 'Aktif Organisasi', point: 10 }
];

// Listeners
export function subscribeSchoolConfig(onUpdate: (config: SchoolConfig) => void, onError?: (err: Error) => void) {
  const path = 'config/school';
  const docRef = doc(db, 'config', 'school');
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        onUpdate(snap.data() as SchoolConfig);
      } else {
        // If config doesn't exist yet, emit default
        onUpdate(DEFAULT_SCHOOL_CONFIG);
      }
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeCategories(onUpdate: (cats: PointCategory[]) => void, onError?: (err: Error) => void) {
  const path = 'categories';
  const q = query(collection(db, path));
  return onSnapshot(
    q,
    (snap) => {
      const cats: PointCategory[] = [];
      snap.forEach((d) => {
        cats.push({ id: d.id, ...d.data() } as PointCategory);
      });
      onUpdate(cats.length ? cats : DEFAULT_CATEGORIES);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeStudents(onUpdate: (students: Student[]) => void, onError?: (err: Error) => void) {
  const path = 'students';
  const q = query(collection(db, path), orderBy('name', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: Student[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Student);
      });
      onUpdate(list);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export function subscribeCounseling(onUpdate: (logs: CounselingLog[]) => void, onError?: (err: Error) => void) {
  const path = 'counseling';
  const q = query(collection(db, path), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const list: CounselingLog[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as CounselingLog);
      });
      onUpdate(list);
    },
    (error) => {
      onError?.(error);
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function fetchStudentPoints(studentId: string): Promise<PointHistoryItem[]> {
  const path = `students/${studentId}/points`;
  try {
    const q = query(collection(db, 'students', studentId, 'points'), orderBy('date', 'desc'));
    const snap = await getDocs(q);
    const points: PointHistoryItem[] = [];
    snap.forEach((d) => {
      points.push({ id: d.id, ...d.data() } as PointHistoryItem);
    });
    return points;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

// Mutations
export async function saveSchoolConfig(config: SchoolConfig) {
  const path = 'config/school';
  try {
    const docRef = doc(db, 'config', 'school');
    await setDoc(docRef, {
      ...config,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function addCategory(category: Omit<PointCategory, 'id'>) {
  const path = 'categories';
  try {
    const newDocRef = doc(collection(db, path));
    await setDoc(newDocRef, {
      ...category,
      createdAt: new Date().toISOString()
    });
    return newDocRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function deleteCategory(id: string) {
  const path = `categories/${id}`;
  try {
    await deleteDoc(doc(db, 'categories', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function addStudent(studentData: Omit<Student, 'id' | 'pointHistory'>) {
  const path = 'students';
  try {
    const docRef = doc(collection(db, path));
    await setDoc(docRef, {
      ...studentData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateStudent(id: string, studentData: Partial<Student>) {
  const path = `students/${id}`;
  try {
    const docRef = doc(db, 'students', id);
    const updatePayload: Record<string, any> = {
      ...studentData,
      updatedAt: new Date().toISOString()
    };
    delete updatePayload.id;
    delete updatePayload.pointHistory;
    await updateDoc(docRef, updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteStudent(id: string) {
  const path = `students/${id}`;
  try {
    // Delete subcollection points first if any
    const pointsRef = collection(db, 'students', id, 'points');
    const pointSnaps = await getDocs(pointsRef);
    const batch = writeBatch(db);
    pointSnaps.forEach((pDoc) => {
      batch.delete(pDoc.ref);
    });
    batch.delete(doc(db, 'students', id));
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function addPointToStudent(
  studentId: string,
  currentScore: number,
  pointItem: Omit<PointHistoryItem, 'id'>
) {
  const path = `students/${studentId}/points`;
  try {
    const studentRef = doc(db, 'students', studentId);
    const pointsCol = collection(db, 'students', studentId, 'points');
    const newPointRef = doc(pointsCol);

    const delta = pointItem.type === 'punishment' ? -pointItem.point : pointItem.point;
    const newScore = Math.max(0, currentScore + delta);

    const batch = writeBatch(db);
    batch.set(newPointRef, {
      ...pointItem,
      studentId,
      loggedBy: auth.currentUser?.uid || 'admin',
      createdAt: new Date().toISOString()
    });
    batch.update(studentRef, {
      score: newScore,
      updatedAt: new Date().toISOString()
    });

    await batch.commit();
    return newScore;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deletePointFromStudent(
  studentId: string,
  currentScore: number,
  pointId: string,
  pointItem: PointHistoryItem
) {
  const path = `students/${studentId}/points/${pointId}`;
  try {
    const studentRef = doc(db, 'students', studentId);
    const pointRef = doc(db, 'students', studentId, 'points', pointId);

    // Revert score
    const delta = pointItem.type === 'punishment' ? pointItem.point : -pointItem.point;
    const newScore = Math.max(0, currentScore + delta);

    const batch = writeBatch(db);
    batch.delete(pointRef);
    batch.update(studentRef, {
      score: newScore,
      updatedAt: new Date().toISOString()
    });

    await batch.commit();
    return newScore;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updatePointItem(
  studentId: string,
  currentScore: number,
  pointId: string,
  oldItem: PointHistoryItem,
  newItem: PointHistoryItem
) {
  const path = `students/${studentId}/points/${pointId}`;
  try {
    const studentRef = doc(db, 'students', studentId);
    const pointRef = doc(db, 'students', studentId, 'points', pointId);

    // Revert old
    let score = currentScore;
    if (oldItem.type === 'punishment') score += oldItem.point;
    else score -= oldItem.point;

    // Apply new
    if (newItem.type === 'punishment') score -= newItem.point;
    else score += newItem.point;

    score = Math.max(0, score);

    const batch = writeBatch(db);
    batch.update(pointRef, {
      date: newItem.date,
      category: newItem.category,
      type: newItem.type,
      point: newItem.point
    });
    batch.update(studentRef, {
      score,
      updatedAt: new Date().toISOString()
    });

    await batch.commit();
    return score;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function addCounselingLog(logData: Omit<CounselingLog, 'id'>) {
  const path = 'counseling';
  try {
    const docRef = doc(collection(db, path));
    await setDoc(docRef, {
      ...logData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    return docRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function updateCounselingLog(id: string, logData: Partial<CounselingLog>) {
  const path = `counseling/${id}`;
  try {
    const docRef = doc(db, 'counseling', id);
    const updatePayload: Record<string, any> = {
      ...logData,
      updatedAt: new Date().toISOString()
    };
    delete updatePayload.id;
    await updateDoc(docRef, updatePayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteCounselingLog(id: string) {
  const path = `counseling/${id}`;
  try {
    await deleteDoc(doc(db, 'counseling', id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function resetStudentPointsInCloud(type: 'punishment' | 'reward' | 'all', defaultScore: number) {
  const path = 'students';
  try {
    const studentsSnap = await getDocs(collection(db, 'students'));
    for (const sDoc of studentsSnap.docs) {
      const studentId = sDoc.id;
      const studentData = sDoc.data() as Student;
      const pointsSnap = await getDocs(collection(db, 'students', studentId, 'points'));
      
      const batch = writeBatch(db);
      let newScore = studentData.score;

      if (type === 'all') {
        pointsSnap.forEach((pDoc) => batch.delete(pDoc.ref));
        newScore = defaultScore;
      } else {
        pointsSnap.forEach((pDoc) => {
          const item = pDoc.data() as PointHistoryItem;
          if (item.type === type) {
            batch.delete(pDoc.ref);
            if (type === 'punishment') newScore += (item.point || 0);
            if (type === 'reward') newScore -= (item.point || 0);
          }
        });
      }

      batch.update(sDoc.ref, {
        score: Math.max(0, newScore),
        updatedAt: new Date().toISOString()
      });

      await batch.commit();
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function migrateLocalStorageToFirestore(localData: AppData): Promise<{ studentsMigrated: number; counselingMigrated: number }> {
  try {
    // 1. Save School Config
    if (localData.school) {
      await saveSchoolConfig(localData.school);
    }

    // 2. Save Categories
    if (localData.categories && localData.categories.length) {
      for (const cat of localData.categories) {
        await addCategory({
          name: cat.name,
          type: cat.type,
          point: cat.point
        });
      }
    }

    // 3. Save Students & Points
    let studentsMigrated = 0;
    if (localData.students && localData.students.length) {
      for (const s of localData.students) {
        const studentId = await addStudent({
          nis: s.nis || '-',
          name: s.name,
          class: s.class,
          psychInfo: s.psychInfo || '-',
          score: s.score ?? localData.school.defaultScore,
          photo: s.photo || null
        });

        if (studentId && s.pointHistory && s.pointHistory.length) {
          const batch = writeBatch(db);
          for (const p of s.pointHistory) {
            const pointRef = doc(collection(db, 'students', studentId, 'points'));
            batch.set(pointRef, {
              date: p.date,
              category: p.category,
              type: p.type,
              point: p.point,
              studentId,
              loggedBy: auth.currentUser?.uid || 'admin',
              createdAt: new Date().toISOString()
            });
          }
          await batch.commit();
        }
        studentsMigrated++;
      }
    }

    // 4. Save Counseling Logs
    let counselingMigrated = 0;
    if (localData.counselingLog && localData.counselingLog.length) {
      for (const c of localData.counselingLog) {
        await addCounselingLog({
          studentName: c.studentName,
          studentClass: c.studentClass,
          date: c.date,
          type: c.type,
          status: c.status || 'Baru',
          desc: c.desc || '',
          result: c.result || '',
          followUp: c.followUp || '',
          followDate: c.followDate || ''
        });
        counselingMigrated++;
      }
    }

    return { studentsMigrated, counselingMigrated };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'migration');
  }
}
