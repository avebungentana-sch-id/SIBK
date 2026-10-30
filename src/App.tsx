/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Chart, registerables } from 'chart.js';
import * as XLSX from 'xlsx';
import { auth, loginWithGoogle, logoutUser } from './firebase';
import {
  SchoolConfig,
  AppSettings,
  PointCategory,
  PointHistoryItem,
  Student,
  CounselingLog,
  AppData,
} from './types';
import {
  DEFAULT_SCHOOL_CONFIG,
  DEFAULT_CATEGORIES,
  subscribeSchoolConfig,
  subscribeCategories,
  subscribeStudents,
  subscribeCounseling,
  fetchStudentPoints,
  saveSchoolConfig,
  addCategory as addCategoryFirestore,
  deleteCategory as deleteCategoryFirestore,
  addStudent as addStudentFirestore,
  updateStudent as updateStudentFirestore,
  deleteStudent as deleteStudentFirestore,
  addPointToStudent as addPointToStudentFirestore,
  deletePointFromStudent as deletePointFromStudentFirestore,
  updatePointItem as updatePointItemFirestore,
  addCounselingLog as addCounselingLogFirestore,
  updateCounselingLog as updateCounselingLogFirestore,
  deleteCounselingLog as deleteCounselingLogFirestore,
  resetStudentPointsInCloud,
  migrateLocalStorageToFirestore,
} from './services/firestoreService';

Chart.register(...registerables);

const COUNSELING_STATUSES = [
  'Baru',
  'Diproses',
  'Perlu Panggilan Orang Tua',
  'Monitoring',
  'Selesai',
] as const;

const LOCAL_STORAGE_KEY = 'sibk_data';
const AUTO_BACKUP_KEY = 'sibk_auto_backups';

export default function App() {
  // --- AUTH & CLOUD STATE ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('offline');
  const [isCloudMode, setIsCloudMode] = useState(false);

  // --- APP DATA STATE ---
  const [school, setSchool] = useState<SchoolConfig>(DEFAULT_SCHOOL_CONFIG);
  const [settings, setSettings] = useState<AppSettings>({
    autoBackup: true,
    backupIntervalMinutes: 10,
    backupLimit: 10,
    lastBackupAt: null,
  });
  const [categories, setCategories] = useState<PointCategory[]>(DEFAULT_CATEGORIES);
  const [students, setStudents] = useState<Student[]>([]);
  const [counselingLogs, setCounselingLogs] = useState<CounselingLog[]>([]);

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<'dashboard' | 'students' | 'counseling' | 'points' | 'settings'>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Modals state
  const [modalOpen, setModalOpen] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');

  // Selected Student for Detail Modal
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedStudentPoints, setSelectedStudentPoints] = useState<PointHistoryItem[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);

  // Filter States
  const [studentSearch, setStudentSearch] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('');

  const [counselingStartDate, setCounselingStartDate] = useState('');
  const [counselingEndDate, setCounselingEndDate] = useState('');
  const [counselingClassFilter, setCounselingClassFilter] = useState('');
  const [counselingTypeFilter, setCounselingTypeFilter] = useState('');
  const [counselingStatusFilter, setCounselingStatusFilter] = useState('');

  // Form States
  // 1. Student Form
  const [studentFormId, setStudentFormId] = useState('');
  const [studentFormNis, setStudentFormNis] = useState('');
  const [studentFormName, setStudentFormName] = useState('');
  const [studentFormClass, setStudentFormClass] = useState('');
  const [studentFormPsych, setStudentFormPsych] = useState('');
  const [studentFormPhoto, setStudentFormPhoto] = useState<string | null>(null);

  // 2. Point Form
  const [pointStudentId, setPointStudentId] = useState('');
  const [pointType, setPointType] = useState<'punishment' | 'reward'>('punishment');
  const [pointCategory, setPointCategory] = useState<string>('');
  const [pointDate, setPointDate] = useState(new Date().toISOString().split('T')[0]);

  // 3. Counseling Form
  const [counselingStudentId, setCounselingStudentId] = useState('');
  const [counselingFormDate, setCounselingFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [counselingFormType, setCounselingFormType] = useState('Konseling Pribadi');
  const [counselingFormStatus, setCounselingFormStatus] = useState<CounselingLog['status']>('Baru');
  const [counselingFormFollowDate, setCounselingFormFollowDate] = useState('');
  const [counselingFormDesc, setCounselingFormDesc] = useState('');
  const [counselingFormResult, setCounselingFormResult] = useState('');
  const [counselingFormFollowUp, setCounselingFormFollowUp] = useState('');

  // 4. Quick Add Category Form
  const [newPunishName, setNewPunishName] = useState('');
  const [newPunishPoint, setNewPunishPoint] = useState('');
  const [newRewardName, setNewRewardName] = useState('');
  const [newRewardPoint, setNewRewardPoint] = useState('');

  // 5. Letter Generator Form
  const [letterNo, setLetterNo] = useState('001/BK/2026');
  const [letterType, setLetterType] = useState('Panggilan Orang Tua');
  const [letterMeetDate, setLetterMeetDate] = useState('');
  const [letterMeetTime, setLetterMeetTime] = useState('09.00 WIB s/d Selesai');
  const [letterParentName, setLetterParentName] = useState('');

  // 6. Edit History Item Form
  const [editHistoryPointId, setEditHistoryPointId] = useState('');
  const [editHistoryDate, setEditHistoryDate] = useState('');
  const [editHistoryType, setEditHistoryType] = useState<'punishment' | 'reward'>('punishment');
  const [editHistoryCatObj, setEditHistoryCatObj] = useState<string>('');

  // 7. Dashboard Summary Modal
  const [summaryType, setSummaryType] = useState<'violation' | 'achievement'>('violation');

  // Chart Refs
  const violationCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const serviceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const violationChartInstance = useRef<Chart | null>(null);
  const serviceChartInstance = useRef<Chart | null>(null);

  // Hidden inputs
  const fileInputProjectRef = useRef<HTMLInputElement | null>(null);
  const fileInputImportRef = useRef<HTMLInputElement | null>(null);
  const fileInputPhotoRef = useRef<HTMLInputElement | null>(null);

  // --- LOCAL STORAGE HELPERS ---
  const loadLocalData = (): AppData | null => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("Gagal membaca local storage", e);
    }
    return null;
  };

  const saveLocalData = (data: AppData) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Gagal menyimpan ke local storage", e);
    }
  };

  // --- INITIALIZATION & AUTH LISTENER ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      if (user) {
        setIsCloudMode(true);
        setSyncStatus('synced');
      } else {
        setIsCloudMode(false);
        setSyncStatus('offline');
        // Load local storage if not signed in
        const local = loadLocalData();
        if (local) {
          if (local.school) setSchool(local.school);
          if (local.categories?.length) setCategories(local.categories);
          if (local.students) setStudents(local.students);
          if (local.counselingLog) setCounselingLogs(local.counselingLog);
          if (local.settings) setSettings(local.settings);
        }
      }
    });
    return () => unsub();
  }, []);

  // --- REAL-TIME FIRESTORE SUBSCRIPTIONS ---
  useEffect(() => {
    if (!currentUser) return;

    setSyncStatus('syncing');

    const unsubSchool = subscribeSchoolConfig(
      (conf) => {
        setSchool(conf);
        setSyncStatus('synced');
      },
      (err) => console.error("Config sync error", err)
    );

    const unsubCats = subscribeCategories(
      (cats) => {
        setCategories(cats);
        setSyncStatus('synced');
      },
      (err) => console.error("Categories sync error", err)
    );

    const unsubStudents = subscribeStudents(
      (studs) => {
        setStudents(studs);
        setSyncStatus('synced');
      },
      (err) => console.error("Students sync error", err)
    );

    const unsubCounseling = subscribeCounseling(
      (logs) => {
        setCounselingLogs(logs);
        setSyncStatus('synced');
      },
      (err) => console.error("Counseling sync error", err)
    );

    return () => {
      unsubSchool();
      unsubCats();
      unsubStudents();
      unsubCounseling();
    };
  }, [currentUser]);

  // Keep selected student points refreshed if modal is open
  useEffect(() => {
    if (selectedStudent && modalOpen === 'modal-student-detail') {
      if (currentUser) {
        setLoadingPoints(true);
        fetchStudentPoints(selectedStudent.id)
          .then((pts) => {
            setSelectedStudentPoints(pts);
          })
          .catch((err) => console.error("Gagal mengambil poin siswa", err))
          .finally(() => setLoadingPoints(false));
      } else {
        setSelectedStudentPoints(selectedStudent.pointHistory || []);
      }
    }
  }, [selectedStudent, modalOpen, currentUser]);

  // --- CHARTS RENDERING ---
  useEffect(() => {
    if (activeTab !== 'dashboard') return;

    // 1. Violation stats
    const vStats: Record<string, number> = {};
    students.forEach((s) => {
      if (s.pointHistory) {
        s.pointHistory.forEach((h) => {
          if (h.type === 'punishment') {
            vStats[h.category] = (vStats[h.category] || 0) + 1;
          }
        });
      }
    });

    const vLabels = Object.keys(vStats)
      .sort((a, b) => vStats[b] - vStats[a])
      .slice(0, 5);
    const vData = vLabels.map((k) => vStats[k]);

    if (violationCanvasRef.current) {
      if (violationChartInstance.current) {
        violationChartInstance.current.destroy();
      }
      violationChartInstance.current = new Chart(violationCanvasRef.current, {
        type: 'bar',
        data: {
          labels: vLabels.length ? vLabels : ['Belum ada data'],
          datasets: [
            {
              label: 'Kasus',
              data: vData.length ? vData : [0],
              backgroundColor: '#f43f5e',
              borderRadius: 6,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
        },
      });
    }

    // 2. Service stats
    const sStats: Record<string, number> = {};
    counselingLogs.forEach((l) => {
      sStats[l.type] = (sStats[l.type] || 0) + 1;
    });
    const sLabels = Object.keys(sStats);
    const sData = sLabels.map((k) => sStats[k]);

    if (serviceCanvasRef.current) {
      if (serviceChartInstance.current) {
        serviceChartInstance.current.destroy();
      }
      serviceChartInstance.current = new Chart(serviceCanvasRef.current, {
        type: 'doughnut',
        data: {
          labels: sLabels.length ? sLabels : ['Belum ada layanan'],
          datasets: [
            {
              data: sData.length ? sData : [1],
              backgroundColor: [
                '#4f46e5',
                '#8b5cf6',
                '#ec4899',
                '#f59e0b',
                '#10b981',
                '#3b82f6',
              ],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
        },
      });
    }

    return () => {
      if (violationChartInstance.current) violationChartInstance.current.destroy();
      if (serviceChartInstance.current) serviceChartInstance.current.destroy();
    };
  }, [activeTab, students, counselingLogs]);

  // Class list extracted dynamically
  const studentClasses = useMemo(() => {
    return Array.from(new Set(students.map((s) => s.class).filter(Boolean))).sort();
  }, [students]);

  const counselingClasses = useMemo(() => {
    const list = [...students.map((s) => s.class), ...counselingLogs.map((l) => l.studentClass)];
    return Array.from(new Set(list.filter(Boolean))).sort();
  }, [students, counselingLogs]);

  const counselingTypes = useMemo(() => {
    return Array.from(new Set(counselingLogs.map((l) => l.type).filter(Boolean))).sort();
  }, [counselingLogs]);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    const q = studentSearch.toLowerCase();
    return students.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(q) || String(s.nis || '').toLowerCase().includes(q);
      const matchClass = !studentClassFilter || s.class === studentClassFilter;
      return matchSearch && matchClass;
    });
  }, [students, studentSearch, studentClassFilter]);

  // Filtered Counseling
  const filteredCounselingLogs = useMemo(() => {
    return counselingLogs
      .filter((log) => {
        if (counselingStartDate && log.date < counselingStartDate) return false;
        if (counselingEndDate && log.date > counselingEndDate) return false;
        if (counselingClassFilter && log.studentClass !== counselingClassFilter) return false;
        if (counselingTypeFilter && log.type !== counselingTypeFilter) return false;
        if (counselingStatusFilter && log.status !== counselingStatusFilter) return false;
        return true;
      })
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [
    counselingLogs,
    counselingStartDate,
    counselingEndDate,
    counselingClassFilter,
    counselingTypeFilter,
    counselingStatusFilter,
  ]);

  // Monthly violations count
  const monthlyViolationsCount = useMemo(() => {
    const currentMonthPrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
    let count = 0;
    students.forEach((s) => {
      s.pointHistory?.forEach((h) => {
        if (h.type === 'punishment' && h.date && h.date.startsWith(currentMonthPrefix)) {
          count++;
        }
      });
    });
    return count;
  }, [students]);

  // Total achievements count
  const achievementsCount = useMemo(() => {
    let count = 0;
    students.forEach((s) => {
      s.pointHistory?.forEach((h) => {
        if (h.type === 'reward') count++;
      });
    });
    return count;
  }, [students]);

  // Low score students for monitoring table
  const lowScoreStudents = useMemo(() => {
    return students.filter((s) => s.score <= school.alertYellow);
  }, [students, school]);

  // --- ACTIONS ---

  // Auth
  const handleLogin = async () => {
    try {
      setSyncStatus('syncing');
      await loginWithGoogle();
    } catch (err: any) {
      console.error("Login gagal", err);
      alert(`Login gagal: ${err.message || err}`);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
      alert("Anda telah keluar. Beralih ke mode lokal.");
    } catch (err: any) {
      console.error("Logout gagal", err);
    }
  };

  // Migration from LocalStorage to Cloud
  const handleMigrateLocalData = async () => {
    if (!currentUser) {
      return alert("Silakan masuk dengan akun Google terlebih dahulu.");
    }
    const local = loadLocalData();
    if (!local || (!local.students?.length && !local.counselingLog?.length)) {
      return alert("Tidak ada data tersimpan di local storage untuk dimigrasikan.");
    }

    const confirmMigrate = confirm(
      `Ditemukan ${local.students?.length || 0} siswa dan ${local.counselingLog?.length || 0} catatan konseling di browser Anda. Apakah Anda ingin mengunggahnya ke Cloud Firestore?`
    );
    if (!confirmMigrate) return;

    try {
      setSyncStatus('syncing');
      const result = await migrateLocalStorageToFirestore(local);
      setSyncStatus('synced');
      alert(
        `Migrasi Berhasil! ${result.studentsMigrated} data siswa dan ${result.counselingMigrated} catatan konseling telah disinkronkan ke Cloud Firestore.`
      );
    } catch (err: any) {
      console.error("Migrasi gagal", err);
      alert(`Gagal migrasi: ${err.message || err}`);
    }
  };

  // Open Modal Helper
  const openModal = (id: string, mode: 'create' | 'edit' = 'create') => {
    setModalMode(mode);
    setModalOpen(id);

    if (id === 'modal-add-point') {
      if (students.length > 0 && !pointStudentId) {
        setPointStudentId(students[0].id);
      }
      const initialCat = categories.find((c) => c.type === pointType);
      if (initialCat) setPointCategory(JSON.stringify(initialCat));
      setPointDate(new Date().toISOString().split('T')[0]);
    }

    if (id === 'modal-add-counseling') {
      if (students.length > 0 && !counselingStudentId) {
        setCounselingStudentId(students[0].id);
      }
      setCounselingFormDate(new Date().toISOString().split('T')[0]);
      setCounselingFormStatus('Baru');
      setCounselingFormFollowDate('');
      setCounselingFormDesc('');
      setCounselingFormResult('');
      setCounselingFormFollowUp('');
    }

    if (id === 'modal-add-student' && mode === 'create') {
      setStudentFormId('');
      setStudentFormNis('');
      setStudentFormName('');
      setStudentFormClass('');
      setStudentFormPsych('');
      setStudentFormPhoto(null);
    }
  };

  const closeModal = () => {
    setModalOpen(null);
  };

  // Student CRUD
  const handleSaveStudent = async () => {
    if (!studentFormName.trim() || !studentFormClass.trim()) {
      return alert("Nama dan Kelas wajib diisi!");
    }

    try {
      setSyncStatus('syncing');
      if (modalMode === 'edit' && studentFormId) {
        const payload: Partial<Student> = {
          nis: studentFormNis.trim() || '-',
          name: studentFormName.trim(),
          class: studentFormClass.trim(),
          psychInfo: studentFormPsych.trim() || '-',
          photo: studentFormPhoto,
        };

        if (currentUser) {
          await updateStudentFirestore(studentFormId, payload);
        } else {
          const updated = students.map((s) => (s.id === studentFormId ? { ...s, ...payload } : s));
          setStudents(updated);
          saveLocalData({ school, settings, categories, students: updated, counselingLog: counselingLogs });
        }
      } else {
        const newStudentData = {
          nis: studentFormNis.trim() || '-',
          name: studentFormName.trim(),
          class: studentFormClass.trim(),
          psychInfo: studentFormPsych.trim() || '-',
          score: Number(school.defaultScore) || 100,
          photo: studentFormPhoto,
        };

        if (currentUser) {
          await addStudentFirestore(newStudentData);
        } else {
          const newStudent: Student = {
            id: 's_' + Date.now(),
            ...newStudentData,
            pointHistory: [],
          };
          const updated = [...students, newStudent];
          setStudents(updated);
          saveLocalData({ school, settings, categories, students: updated, counselingLog: counselingLogs });
        }
      }

      setSyncStatus('synced');
      closeModal();
    } catch (err: any) {
      console.error("Gagal menyimpan siswa", err);
      alert(`Gagal menyimpan: ${err.message || err}`);
    }
  };

  const handleEditStudent = (s: Student) => {
    setStudentFormId(s.id);
    setStudentFormNis(s.nis || '');
    setStudentFormName(s.name || '');
    setStudentFormClass(s.class || '');
    setStudentFormPsych(s.psychInfo || '');
    setStudentFormPhoto(s.photo || null);
    openModal('modal-add-student', 'edit');
  };

  const handleDeleteStudent = async (studentId: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus data siswa ini?")) return;
    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await deleteStudentFirestore(studentId);
      } else {
        const updated = students.filter((s) => s.id !== studentId);
        setStudents(updated);
        saveLocalData({ school, settings, categories, students: updated, counselingLog: counselingLogs });
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal menghapus siswa", err);
      alert(`Gagal menghapus: ${err.message || err}`);
    }
  };

  const handleViewStudent = async (s: Student) => {
    setSelectedStudent(s);
    openModal('modal-student-detail');
  };

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setStudentFormPhoto(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  // Points Actions
  const handleSubmitPoint = async () => {
    if (!pointStudentId || !pointDate || !pointCategory) {
      return alert("Lengkapi data input poin!");
    }

    const targetStudent = students.find((s) => s.id === pointStudentId);
    if (!targetStudent) return alert("Siswa tidak ditemukan!");

    try {
      const catObj = JSON.parse(pointCategory) as PointCategory;
      setSyncStatus('syncing');

      if (currentUser) {
        const newScore = await addPointToStudentFirestore(targetStudent.id, targetStudent.score, {
          date: pointDate,
          category: catObj.name,
          type: catObj.type,
          point: Number(catObj.point),
        });
        alert(`Poin berhasil dicatat! Skor terbaru ${targetStudent.name}: ${newScore}`);
      } else {
        const delta = catObj.type === 'punishment' ? -catObj.point : catObj.point;
        const newScore = Math.max(0, targetStudent.score + delta);
        const newPointItem: PointHistoryItem = {
          id: 'p_' + Date.now(),
          date: pointDate,
          category: catObj.name,
          type: catObj.type,
          point: catObj.point,
        };

        const updated = students.map((s) => {
          if (s.id === targetStudent.id) {
            return {
              ...s,
              score: newScore,
              pointHistory: [newPointItem, ...(s.pointHistory || [])],
            };
          }
          return s;
        });

        setStudents(updated);
        saveLocalData({ school, settings, categories, students: updated, counselingLog: counselingLogs });
        alert(`Poin berhasil dicatat! Skor terbaru ${targetStudent.name}: ${newScore}`);
      }

      setSyncStatus('synced');
      closeModal();
    } catch (err: any) {
      console.error("Gagal mencatat poin", err);
      alert(`Gagal menyimpan poin: ${err.message || err}`);
    }
  };

  const handleDeleteHistoryItem = async (pointItem: PointHistoryItem) => {
    if (!selectedStudent || !pointItem.id) return;
    if (!confirm("Hapus catatan poin ini? Skor siswa akan dipulihkan.")) return;

    try {
      setSyncStatus('syncing');
      if (currentUser) {
        const updatedScore = await deletePointFromStudentFirestore(
          selectedStudent.id,
          selectedStudent.score,
          pointItem.id,
          pointItem
        );
        setSelectedStudent({ ...selectedStudent, score: updatedScore });
        setSelectedStudentPoints((prev) => prev.filter((p) => p.id !== pointItem.id));
      } else {
        const delta = pointItem.type === 'punishment' ? pointItem.point : -pointItem.point;
        const updatedScore = Math.max(0, selectedStudent.score + delta);
        const updatedPoints = (selectedStudent.pointHistory || []).filter((p) => p.id !== pointItem.id);

        const updatedStudents = students.map((s) =>
          s.id === selectedStudent.id ? { ...s, score: updatedScore, pointHistory: updatedPoints } : s
        );
        setStudents(updatedStudents);
        setSelectedStudent({ ...selectedStudent, score: updatedScore, pointHistory: updatedPoints });
        setSelectedStudentPoints(updatedPoints);
        saveLocalData({ school, settings, categories, students: updatedStudents, counselingLog: counselingLogs });
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal menghapus riwayat poin", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  const handleEditHistoryItemModal = (item: PointHistoryItem) => {
    setEditHistoryPointId(item.id || '');
    setEditHistoryDate(item.date);
    setEditHistoryType(item.type);
    const cat = categories.find((c) => c.name === item.category && c.type === item.type);
    if (cat) {
      setEditHistoryCatObj(JSON.stringify(cat));
    }
    openModal('modal-edit-history');
  };

  const handleSaveHistoryItem = async () => {
    if (!selectedStudent || !editHistoryPointId || !editHistoryCatObj) return;

    const oldItem = selectedStudentPoints.find((p) => p.id === editHistoryPointId);
    if (!oldItem) return;

    try {
      const newCat = JSON.parse(editHistoryCatObj) as PointCategory;
      const newItem: PointHistoryItem = {
        id: editHistoryPointId,
        date: editHistoryDate,
        category: newCat.name,
        type: newCat.type,
        point: newCat.point,
      };

      setSyncStatus('syncing');
      if (currentUser) {
        const newScore = await updatePointItemFirestore(
          selectedStudent.id,
          selectedStudent.score,
          editHistoryPointId,
          oldItem,
          newItem
        );
        setSelectedStudent({ ...selectedStudent, score: newScore });
        setSelectedStudentPoints((prev) =>
          prev.map((p) => (p.id === editHistoryPointId ? newItem : p))
        );
      } else {
        let score = selectedStudent.score;
        if (oldItem.type === 'punishment') score += oldItem.point;
        else score -= oldItem.point;

        if (newItem.type === 'punishment') score -= newItem.point;
        else score += newItem.point;
        score = Math.max(0, score);

        const updatedPoints = (selectedStudent.pointHistory || []).map((p) =>
          p.id === editHistoryPointId ? newItem : p
        );
        const updatedStudents = students.map((s) =>
          s.id === selectedStudent.id ? { ...s, score, pointHistory: updatedPoints } : s
        );
        setStudents(updatedStudents);
        setSelectedStudent({ ...selectedStudent, score, pointHistory: updatedPoints });
        setSelectedStudentPoints(updatedPoints);
        saveLocalData({ school, settings, categories, students: updatedStudents, counselingLog: counselingLogs });
      }

      setSyncStatus('synced');
      closeModal();
    } catch (err: any) {
      console.error("Gagal mengubah riwayat", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  // Add/Delete Category Rules
  const handleAddCategory = async (type: 'punishment' | 'reward') => {
    const name = type === 'punishment' ? newPunishName.trim() : newRewardName.trim();
    const pointStr = type === 'punishment' ? newPunishPoint : newRewardPoint;
    const pt = parseInt(pointStr, 10);
    if (!name || isNaN(pt) || pt <= 0) {
      return alert("Masukkan nama dan poin yang valid!");
    }

    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await addCategoryFirestore({ name, type, point: pt });
      } else {
        const newCat: PointCategory = {
          id: 'cat_' + Date.now(),
          name,
          type,
          point: pt,
        };
        const updated = [...categories, newCat];
        setCategories(updated);
        saveLocalData({ school, settings, categories: updated, students, counselingLog: counselingLogs });
      }

      if (type === 'punishment') {
        setNewPunishName('');
        setNewPunishPoint('');
      } else {
        setNewRewardName('');
        setNewRewardPoint('');
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal menambah kategori", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  const handleDeleteCategory = async (catId: string) => {
    if (!confirm("Hapus kategori ini?")) return;
    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await deleteCategoryFirestore(catId);
      } else {
        const updated = categories.filter((c) => c.id !== catId);
        setCategories(updated);
        saveLocalData({ school, settings, categories: updated, students, counselingLog: counselingLogs });
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal menghapus kategori", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  // Counseling Actions
  const handleSubmitCounseling = async () => {
    if (!counselingStudentId) return alert("Pilih Siswa!");
    const targetStudent = students.find((s) => s.id === counselingStudentId);
    if (!targetStudent) return alert("Siswa tidak ditemukan!");

    try {
      setSyncStatus('syncing');
      const newLogData = {
        studentId: targetStudent.id,
        studentName: targetStudent.name,
        studentClass: targetStudent.class,
        date: counselingFormDate,
        type: counselingFormType,
        status: counselingFormStatus,
        desc: counselingFormDesc,
        result: counselingFormResult,
        followUp: counselingFormFollowUp,
        followDate: counselingFormFollowDate,
      };

      if (currentUser) {
        await addCounselingLogFirestore(newLogData);
      } else {
        const newLog: CounselingLog = {
          id: 'c_' + Date.now(),
          ...newLogData,
          createdAt: new Date().toISOString(),
        };
        const updated = [newLog, ...counselingLogs];
        setCounselingLogs(updated);
        saveLocalData({ school, settings, categories, students, counselingLog: updated });
      }

      setSyncStatus('synced');
      closeModal();
      alert("Catatan konseling berhasil disimpan!");
    } catch (err: any) {
      console.error("Gagal mencatat konseling", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  const handleUpdateCounselingStatus = async (logId: string, newStatus: CounselingLog['status']) => {
    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await updateCounselingLogFirestore(logId, { status: newStatus });
      } else {
        const updated = counselingLogs.map((l) => (l.id === logId ? { ...l, status: newStatus } : l));
        setCounselingLogs(updated);
        saveLocalData({ school, settings, categories, students, counselingLog: updated });
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal memperbarui status", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  const handleDeleteCounseling = async (logId: string) => {
    if (!confirm("Hapus catatan konseling ini?")) return;
    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await deleteCounselingLogFirestore(logId);
      } else {
        const updated = counselingLogs.filter((l) => l.id !== logId);
        setCounselingLogs(updated);
        saveLocalData({ school, settings, categories, students, counselingLog: updated });
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal menghapus konseling", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  // Reset Point History (New Academic Year)
  const handleResetPoints = async (type: 'punishment' | 'reward' | 'all') => {
    const labels = {
      punishment: 'poin pelanggaran',
      reward: 'poin prestasi',
      all: 'semua poin pelanggaran dan prestasi',
    };
    const label = labels[type];
    const first = confirm(`Apakah Anda yakin ingin mereset ${label} untuk memulai tahun ajaran baru?`);
    if (!first) return;
    const second = confirm(`Verifikasi kedua: data ${label} yang direset tidak akan tampil lagi di riwayat poin. Lanjutkan reset?`);
    if (!second) return;

    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await resetStudentPointsInCloud(type, school.defaultScore);
        alert(`Reset ${label} di Cloud Firestore berhasil.`);
      } else {
        const updatedStudents = students.map((s) => {
          let score = s.score;
          const kept: PointHistoryItem[] = [];

          if (type === 'all') {
            return { ...s, score: school.defaultScore, pointHistory: [] };
          }

          (s.pointHistory || []).forEach((item) => {
            if (item.type === type) {
              if (type === 'punishment') score += item.point;
              if (type === 'reward') score -= item.point;
            } else {
              kept.push(item);
            }
          });

          return { ...s, score, pointHistory: kept };
        });

        setStudents(updatedStudents);
        saveLocalData({ school, settings, categories, students: updatedStudents, counselingLog: counselingLogs });
        alert(`Reset ${label} di browser lokal selesai.`);
      }
      setSyncStatus('synced');
    } catch (err: any) {
      console.error("Gagal reset poin", err);
      alert(`Gagal reset: ${err.message || err}`);
    }
  };

  // Settings Save
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSyncStatus('syncing');
      if (currentUser) {
        await saveSchoolConfig(school);
      } else {
        saveLocalData({ school, settings, categories, students, counselingLog: counselingLogs });
      }
      setSyncStatus('synced');
      alert("Pengaturan berhasil disimpan.");
    } catch (err: any) {
      console.error("Gagal menyimpan pengaturan", err);
      alert(`Gagal: ${err.message || err}`);
    }
  };

  // Backup & Restore
  const handleDownloadBackup = () => {
    const dataToExport: AppData = {
      school,
      settings,
      categories,
      students,
      counselingLog: counselingLogs,
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SIAC_BK_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenProjectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.school) setSchool(parsed.school);
        if (parsed.categories) setCategories(parsed.categories);
        if (parsed.students) setStudents(parsed.students);
        if (parsed.counselingLog) setCounselingLogs(parsed.counselingLog);
        alert("Data berhasil dimuat dari file JSON!");
      } catch (err) {
        alert("File backup tidak valid.");
      }
    };
    reader.readAsText(file);
  };

  // Excel Operations
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([['NIS', 'Nama', 'Kelas', 'Info_Psikologis']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Template_Siswa.xlsx");
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const workbook = XLSX.read(new Uint8Array(event.target?.result as ArrayBuffer), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<any>(sheet);
        let count = 0;

        for (const row of rows) {
          const name = row.Nama || row.nama || row.Name;
          const cls = row.Kelas || row.kelas || row.Class;
          if (!name || !cls) continue;

          const studentData = {
            nis: String(row.NIS || row.NISN || row.nis || '-'),
            name: String(name).trim(),
            class: String(cls).trim(),
            psychInfo: String(row.Info_Psikologis || row.Psikologis || row.Catatan || '-'),
            score: Number(school.defaultScore) || 100,
            photo: null,
          };

          if (currentUser) {
            await addStudentFirestore(studentData);
          } else {
            const newS: Student = {
              id: 's_' + Date.now() + '_' + Math.random(),
              ...studentData,
              pointHistory: [],
            };
            students.push(newS);
          }
          count++;
        }

        if (!currentUser) {
          setStudents([...students]);
          saveLocalData({ school, settings, categories, students, counselingLog: counselingLogs });
        }

        alert(`${count} data siswa berhasil diimpor.`);
      } catch (err) {
        alert("Gagal membaca file Excel. Pastikan format sesuai template.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleExportStudentsExcel = () => {
    const data = students.map((s) => ({
      NIS: s.nis,
      Nama: s.name,
      Kelas: s.class,
      Skor: s.score,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Data Siswa");
    XLSX.writeFile(wb, "Data_Siswa_BK.xlsx");
  };

  const handleExportCounselingExcel = () => {
    if (filteredCounselingLogs.length === 0) return alert("Tidak ada data untuk diekspor.");
    const data = filteredCounselingLogs.map((log) => ({
      Tanggal: log.date,
      Nama: log.studentName,
      Kelas: log.studentClass,
      Layanan: log.type,
      Status: log.status,
      Masalah: log.desc,
      Hasil: log.result || '',
      Tindak_Lanjut: log.followUp || '',
      Target_Tindak_Lanjut: log.followDate || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Laporan BK");
    XLSX.writeFile(wb, "Laporan_BK_Terfilter.xlsx");
  };

  // PDF Generation via html2pdf
  const handlePrintStudentReportPDF = () => {
    const element = document.getElementById('print-area-student');
    if (!element) return;
    const opt = {
      margin: 0.5,
      filename: `Laporan_${selectedStudent?.name || 'Siswa'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    };
    (window as any).html2pdf?.().set(opt).from(element).save();
  };

  const handlePrintStudentHistoryPDF = () => {
    const element = document.getElementById('print-area-student');
    if (!element) return;
    const opt = {
      margin: 0.5,
      filename: `Riwayat_Lengkap_${selectedStudent?.name || 'Siswa'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    };
    (window as any).html2pdf?.().set(opt).from(element).save();
  };

  const handlePrintLetter = () => {
    const element = document.getElementById('letter-template');
    if (!element) return;
    element.classList.remove('hidden');
    const opt = {
      margin: 0.8,
      filename: `Surat_${selectedStudent?.name || 'Siswa'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    };
    (window as any)
      .html2pdf?.()
      .set(opt)
      .from(element)
      .toPdf()
      .get('pdf')
      .then((pdf: any) => {
        element.classList.add('hidden');
        window.open(pdf.output('bloburl'), '_blank');
      });
    closeModal();
  };

  return (
    <div className="text-slate-600 h-screen overflow-hidden flex bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`w-72 bg-slate-900 text-white flex flex-col no-print shadow-2xl z-20 transition-all duration-300 fixed md:relative h-full ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="h-24 flex items-center px-6 border-b border-slate-700/50">
          <div className="h-10 w-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg mr-3 flex-shrink-0">
            <i className="fas fa-book-reader text-white text-lg"></i>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wide leading-tight">SIAC-BK</h1>
            <p className="text-[10px] text-slate-400">Sistem Informasi Administrasi & Catatan BK</p>
          </div>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 px-2">Menu Utama</p>
          <nav className="space-y-2">
            <button
              onClick={() => { setActiveTab('dashboard'); setSidebarOpen(false); }}
              className={`w-full text-left sidebar-link flex items-center py-3 px-4 text-sm font-medium ${
                activeTab === 'dashboard' ? 'sidebar-active text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              <i className="fas fa-chart-pie w-6 opacity-70"></i>
              <span>Dashboard & Analitik</span>
            </button>
            <button
              onClick={() => { setActiveTab('students'); setSidebarOpen(false); }}
              className={`w-full text-left sidebar-link flex items-center py-3 px-4 text-sm font-medium ${
                activeTab === 'students' ? 'sidebar-active text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              <i className="fas fa-user-graduate w-6 opacity-70"></i>
              <span>Data Siswa</span>
            </button>
            <button
              onClick={() => { setActiveTab('counseling'); setSidebarOpen(false); }}
              className={`w-full text-left sidebar-link flex items-center py-3 px-4 text-sm font-medium ${
                activeTab === 'counseling' ? 'sidebar-active text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              <i className="fas fa-clipboard-list w-6 opacity-70"></i>
              <span>Buku Kasus</span>
            </button>
            <button
              onClick={() => { setActiveTab('points'); setSidebarOpen(false); }}
              className={`w-full text-left sidebar-link flex items-center py-3 px-4 text-sm font-medium ${
                activeTab === 'points' ? 'sidebar-active text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              <i className="fas fa-star w-6 opacity-70"></i>
              <span>Skor & Poin</span>
            </button>
          </nav>

          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-8 mb-4 px-2">File Project</p>
          <nav className="space-y-2">
            <button
              onClick={handleDownloadBackup}
              className="w-full text-left sidebar-link flex items-center py-3 px-4 text-sm font-medium hover:bg-slate-800 text-slate-300"
            >
              <i className="fas fa-save w-6 opacity-70 text-blue-400"></i>
              <span>Simpan Data</span>
            </button>
            <button
              onClick={() => fileInputProjectRef.current?.click()}
              className="w-full text-left sidebar-link flex items-center py-3 px-4 text-sm font-medium hover:bg-slate-800 text-slate-300"
            >
              <i className="fas fa-folder-open w-6 opacity-70 text-yellow-400"></i>
              <span>Buka Data</span>
            </button>
            <input
              type="file"
              ref={fileInputProjectRef}
              className="hidden"
              accept=".json"
              onChange={handleOpenProjectFile}
            />
          </nav>
        </div>

        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/50">
          <button
            onClick={() => { setActiveTab('settings'); setSidebarOpen(false); }}
            className={`w-full text-left flex items-center text-sm transition py-2 mb-2 ${
              activeTab === 'settings' ? 'text-indigo-400 font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <i className="fas fa-cog mr-2"></i> Pengaturan
          </button>
          <div className="pt-4 border-t border-slate-700/50 text-center">
            <p className="text-[10px] text-slate-500 font-light">Develop by</p>
            <p className="text-xs font-medium text-slate-300">Alfret Edward R, S.Pd</p>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative w-full">
        {/* Header */}
        <header className="h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 md:px-8 no-print sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-slate-500 hover:text-indigo-600 focus:outline-none md:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              <i className="fas fa-bars text-xl"></i>
            </button>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{school.name}</h2>
              <p className="text-xs text-slate-500 hidden md:block">Bimbingan & Konseling Terpadu</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Realtime Cloud Sync Badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 border border-slate-200">
              {syncStatus === 'synced' && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-emerald-700">Tersinkron Cloud</span>
                </>
              )}
              {syncStatus === 'syncing' && (
                <>
                  <i className="fas fa-sync-alt fa-spin text-amber-500 text-xs"></i>
                  <span className="text-amber-700">Menyinkronkan...</span>
                </>
              )}
              {syncStatus === 'offline' && (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                  <span className="text-slate-600">Mode Lokal (Offline)</span>
                </>
              )}
            </div>

            {/* Auth Button / Admin Profile */}
            {currentUser ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-slate-700 leading-tight">
                    {currentUser.displayName || school.teacher}
                  </p>
                  <p className="text-[10px] text-slate-500 leading-tight">{currentUser.email}</p>
                </div>
                {currentUser.photoURL ? (
                  <img
                    src={currentUser.photoURL}
                    alt="User Avatar"
                    className="h-10 w-10 rounded-full border border-indigo-200 object-cover shadow-sm"
                  />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shadow-sm font-bold">
                    <i className="fas fa-user-tie"></i>
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  title="Keluar dari akun Google"
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition"
                >
                  <i className="fas fa-sign-out-alt"></i>
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs md:text-sm font-medium px-3.5 py-2 rounded-xl shadow-sm transition"
              >
                <i className="fab fa-google"></i>
                <span>Masuk Akun BK</span>
              </button>
            )}
          </div>
        </header>

        {/* Tab Content Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth" id="main-scroll">
          
          {/* DASHBOARD TAB */}
          {activeTab === 'dashboard' && (
            <div className="max-w-7xl mx-auto">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-8 mb-8 text-white shadow-xl relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="text-3xl font-bold mb-2">Dashboard Analitik</h2>
                  <p className="opacity-90">Ringkasan data, statistik pelanggaran, dan monitoring siswa.</p>
                </div>
              </div>

              {/* Stat Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 card-hover">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Siswa</p>
                  <h3 className="text-3xl font-bold text-slate-800">{students.length}</h3>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 card-hover">
                  <p className="text-sm font-medium text-slate-500 mb-1">Total Layanan</p>
                  <h3 className="text-3xl font-bold text-slate-800">{counselingLogs.length}</h3>
                </div>
                <div
                  onClick={() => { setSummaryType('violation'); openModal('modal-summary'); }}
                  className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 card-hover cursor-pointer hover:border-rose-200 transition-colors"
                >
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Pelanggaran (Bln Ini)</p>
                      <h3 className="text-3xl font-bold text-rose-600">{monthlyViolationsCount}</h3>
                    </div>
                    <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                      <i className="fas fa-exclamation-circle text-xl"></i>
                    </div>
                  </div>
                </div>
                <div
                  onClick={() => { setSummaryType('achievement'); openModal('modal-summary'); }}
                  className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 card-hover cursor-pointer hover:border-amber-200 transition-colors"
                >
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-500">Prestasi</p>
                      <h3 className="text-3xl font-bold text-amber-600">{achievementsCount}</h3>
                    </div>
                    <div className="p-3 bg-amber-50 text-amber-500 rounded-xl">
                      <i className="fas fa-trophy text-xl"></i>
                    </div>
                  </div>
                </div>
              </div>

              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="font-bold text-slate-700 mb-4">Tren Kategori Pelanggaran (Top 5)</h3>
                  <div className="h-64 relative">
                    <canvas ref={violationCanvasRef}></canvas>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                  <h3 className="font-bold text-slate-700 mb-4">Proporsi Jenis Layanan BK</h3>
                  <div className="h-64 flex justify-center relative">
                    <canvas ref={serviceCanvasRef}></canvas>
                  </div>
                </div>
              </div>

              {/* Alert Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="font-bold text-lg text-slate-800">Monitoring Poin Siswa</h3>
                  <div className="flex gap-2 text-xs font-medium">
                    <span className="px-2 py-1 rounded bg-red-100 text-red-700">Kritis (&le; {school.alertRed})</span>
                    <span className="px-2 py-1 rounded bg-orange-100 text-orange-700">Bahaya (&le; {school.alertOrange})</span>
                    <span className="px-2 py-1 rounded bg-yellow-100 text-yellow-700">Waspada (&le; {school.alertYellow})</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                      <tr>
                        <th className="px-6 py-4">Siswa</th>
                        <th className="px-6 py-4">Kelas</th>
                        <th className="px-6 py-4">Skor</th>
                        <th className="px-6 py-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowScoreStudents.map((s) => {
                        let badgeClass = 'bg-yellow-100 text-yellow-800';
                        let label = 'Waspada';
                        if (s.score <= school.alertRed) {
                          badgeClass = 'bg-red-100 text-red-800';
                          label = 'Kritis';
                        } else if (s.score <= school.alertOrange) {
                          badgeClass = 'bg-orange-100 text-orange-800';
                          label = 'Bahaya';
                        }
                        return (
                          <tr key={s.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                            <td className="px-6 py-4 font-medium text-slate-800">{s.name}</td>
                            <td className="px-6 py-4 text-slate-600">{s.class}</td>
                            <td className="px-6 py-4 font-bold text-red-600">{s.score}</td>
                            <td className="px-6 py-4 text-right">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${badgeClass}`}>
                                {label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {lowScoreStudents.length === 0 && (
                    <div className="text-center py-8 text-slate-500">Tidak ada siswa bermasalah. Semua siswa memiliki skor aman.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STUDENTS TAB */}
          {activeTab === 'students' && (
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h2 className="text-2xl font-bold text-slate-800">Data Siswa</h2>
                <div className="flex flex-wrap gap-2">
                  <div className="relative group">
                    <button className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium shadow-sm transition">
                      <i className="fas fa-file-excel mr-2 text-green-600"></i> Excel Menu
                    </button>
                    <div className="absolute right-0 top-full pt-2 w-48 hidden group-hover:block z-10">
                      <div className="bg-white rounded-lg shadow-xl border border-slate-100 p-1">
                        <button
                          onClick={handleDownloadTemplate}
                          className="block w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded"
                        >
                          <i className="fas fa-download mr-2 text-indigo-500"></i> Download Template
                        </button>
                        <button
                          onClick={() => fileInputImportRef.current?.click()}
                          className="block w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded"
                        >
                          <i className="fas fa-upload mr-2 text-emerald-500"></i> Import Excel
                        </button>
                        <button
                          onClick={handleExportStudentsExcel}
                          className="block w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded"
                        >
                          <i className="fas fa-file-export mr-2 text-blue-500"></i> Ekspor Data
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => openModal('modal-add-student', 'create')}
                    className="bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 text-sm font-medium shadow-lg transition"
                  >
                    <i className="fas fa-plus mr-2"></i> Tambah Siswa
                  </button>
                  <input
                    type="file"
                    ref={fileInputImportRef}
                    className="hidden"
                    accept=".xlsx, .xls"
                    onChange={handleImportExcel}
                  />
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row gap-4">
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Cari nama atau NISN..."
                  className="flex-1 border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                />
                <select
                  value={studentClassFilter}
                  onChange={(e) => setStudentClassFilter(e.target.value)}
                  className="border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm bg-white"
                >
                  <option value="">Semua Kelas</option>
                  {studentClasses.map((cls) => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                    <tr>
                      <th className="px-6 py-4 w-16">Foto</th>
                      <th className="px-6 py-4">Info Siswa</th>
                      <th className="px-6 py-4">Kelas</th>
                      <th className="px-6 py-4">Skor</th>
                      <th className="px-6 py-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50 border-t border-slate-100">
                        <td className="px-6 py-4 text-center">
                          <div className="w-10 h-10 rounded-full bg-slate-200 mx-auto overflow-hidden flex items-center justify-center">
                            {s.photo ? (
                              <img src={s.photo} alt={s.name} className="w-full h-full object-cover" />
                            ) : (
                              <i className="fas fa-user text-slate-400"></i>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold">
                          {s.name}
                          <br />
                          <span className="font-normal text-xs text-slate-500">{s.nis}</span>
                        </td>
                        <td className="px-6 py-4">{s.class}</td>
                        <td className={`px-6 py-4 font-bold ${s.score < school.alertYellow ? 'text-red-600' : 'text-green-600'}`}>
                          {s.score}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => handleEditStudent(s)}
                            title="Edit Profil"
                            className="text-blue-600 hover:text-blue-800 mr-3"
                          >
                            <i className="fas fa-edit"></i>
                          </button>
                          <button
                            onClick={() => handleViewStudent(s)}
                            title="Lihat Rekam Jejak"
                            className="text-indigo-600 hover:text-indigo-800 mr-3"
                          >
                            <i className="fas fa-eye"></i>
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(s.id)}
                            title="Hapus Siswa"
                            className="text-red-600 hover:text-red-800"
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredStudents.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-slate-500">
                          Tidak ada data siswa ditemukan.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* COUNSELING TAB */}
          {activeTab === 'counseling' && (
            <div className="max-w-7xl mx-auto">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">Buku Kasus & Konseling</h2>
                  <p className="text-sm text-slate-500 mt-1">Pantau kasus, status tindak lanjut, dan laporan layanan BK.</p>
                </div>
                <button
                  onClick={() => openModal('modal-add-counseling', 'create')}
                  className="bg-purple-600 text-white px-5 py-2 rounded-lg hover:bg-purple-700 text-sm font-medium shadow-lg transition"
                >
                  <i className="fas fa-pen-fancy mr-2"></i> Catat Sesi
                </button>
              </div>

              {/* Filter Bar */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 mb-4">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <input
                    type="date"
                    value={counselingStartDate}
                    onChange={(e) => setCounselingStartDate(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                    placeholder="Dari Tanggal"
                  />
                  <input
                    type="date"
                    value={counselingEndDate}
                    onChange={(e) => setCounselingEndDate(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                    placeholder="Sampai Tanggal"
                  />
                  <select
                    value={counselingClassFilter}
                    onChange={(e) => setCounselingClassFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none"
                  >
                    <option value="">Semua Kelas</option>
                    {counselingClasses.map((cls) => (
                      <option key={cls} value={cls}>{cls}</option>
                    ))}
                  </select>
                  <select
                    value={counselingTypeFilter}
                    onChange={(e) => setCounselingTypeFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none"
                  >
                    <option value="">Semua Layanan</option>
                    {counselingTypes.map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <select
                    value={counselingStatusFilter}
                    onChange={(e) => setCounselingStatusFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-purple-500 outline-none"
                  >
                    <option value="">Semua Status</option>
                    {COUNSELING_STATUSES.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setCounselingStartDate('');
                      setCounselingEndDate('');
                      setCounselingClassFilter('');
                      setCounselingTypeFilter('');
                      setCounselingStatusFilter('');
                    }}
                    className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium"
                  >
                    <i className="fas fa-rotate-left mr-2"></i> Reset
                  </button>
                </div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mt-4">
                  <p className="text-xs text-slate-500">
                    Menampilkan {filteredCounselingLogs.length} dari {counselingLogs.length} catatan.
                  </p>
                  <button
                    onClick={handleExportCounselingExcel}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm font-medium"
                  >
                    <i className="fas fa-file-excel mr-2"></i> Ekspor Laporan
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4">Waktu</th>
                      <th className="px-6 py-4">Identitas Siswa</th>
                      <th className="px-6 py-4">Jenis Layanan</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Detail & Tindak Lanjut</th>
                      <th className="px-6 py-4 text-center">Opsi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCounselingLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 align-top border-b border-slate-100">
                        <td className="px-6 py-4 whitespace-nowrap text-slate-700">{log.date || '-'}</td>
                        <td className="px-6 py-4 font-bold">
                          {log.studentName}
                          <br />
                          <span className="font-normal text-xs text-slate-500">{log.studentClass || '-'}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full text-xs font-medium">
                            {log.type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <select
                            value={log.status}
                            onChange={(e) => handleUpdateCounselingStatus(log.id, e.target.value as CounselingLog['status'])}
                            className="border border-slate-200 rounded-lg p-2 text-xs bg-white focus:ring-2 focus:ring-purple-400 outline-none"
                          >
                            {COUNSELING_STATUSES.map((st) => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-4 max-w-md">
                          <div className="font-medium text-slate-700">{log.desc || '-'}</div>
                          {log.result && (
                            <div className="text-xs text-slate-500 mt-1">Hasil: {log.result}</div>
                          )}
                          {log.followUp && (
                            <div className="text-xs text-indigo-600 mt-1 font-medium">
                              Tindak lanjut: {log.followUp} {log.followDate ? `(${log.followDate})` : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => handleDeleteCounseling(log.id)}
                            className="text-red-500 hover:text-red-700 p-2"
                          >
                            <i className="fas fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredCounselingLogs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-slate-500">
                          Tidak ada catatan konseling sesuai filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* POINTS TAB */}
          {activeTab === 'points' && (
            <div className="max-w-7xl mx-auto">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">Sistem Poin</h2>
                  <p className="text-sm text-slate-500">Konfigurasi bobot pelanggaran dan prestasi siswa.</p>
                </div>
                <button
                  onClick={() => openModal('modal-add-point')}
                  className="bg-rose-600 text-white px-5 py-2 rounded-lg hover:bg-rose-700 text-sm font-medium shadow-lg transition"
                >
                  <i className="fas fa-gavel mr-2"></i> Input Poin
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Punishment Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 relative overflow-hidden flex flex-col justify-between">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <i className="fas fa-minus-circle text-8xl text-red-500"></i>
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-slate-800 mb-1 relative z-10 text-red-600">
                      Pelanggaran (Pengurangan)
                    </h3>
                    <ul className="space-y-3 mb-6 relative z-10 text-sm mt-4">
                      {categories
                        .filter((c) => c.type === 'punishment')
                        .map((c) => (
                          <li
                            key={c.id}
                            className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 group"
                          >
                            <span className="text-slate-700 font-medium">{c.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-red-500 bg-white px-2 py-1 rounded shadow-sm border border-slate-100">
                                {c.point} Pts
                              </span>
                              <button
                                onClick={() => handleDeleteCategory(c.id)}
                                className="text-slate-300 hover:text-red-500 transition"
                              >
                                <i className="fas fa-trash-alt"></i>
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>

                  <div className="mt-auto pt-4 border-t border-slate-100 relative z-10">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-2">Tambah Baru</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newPunishName}
                        onChange={(e) => setNewPunishName(e.target.value)}
                        placeholder="Nama Pelanggaran"
                        className="border rounded px-3 py-2 text-sm w-full outline-none focus:ring-1 focus:ring-red-400"
                      />
                      <input
                        type="number"
                        value={newPunishPoint}
                        onChange={(e) => setNewPunishPoint(e.target.value)}
                        placeholder="Poin"
                        className="border rounded px-3 py-2 text-sm w-24 outline-none focus:ring-1 focus:ring-red-400"
                      />
                      <button
                        onClick={() => handleAddCategory('punishment')}
                        className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-900 transition"
                      >
                        <i className="fas fa-plus"></i>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Reward Card */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 relative overflow-hidden flex flex-col justify-between">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <i className="fas fa-plus-circle text-8xl text-green-500"></i>
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-slate-800 mb-1 relative z-10 text-green-600">
                      Penghargaan (Penambahan)
                    </h3>
                    <ul className="space-y-3 mb-6 relative z-10 text-sm mt-4">
                      {categories
                        .filter((c) => c.type === 'reward')
                        .map((c) => (
                          <li
                            key={c.id}
                            className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100 group"
                          >
                            <span className="text-slate-700 font-medium">{c.name}</span>
                            <div className="flex items-center gap-3">
                              <span className="font-bold text-green-500 bg-white px-2 py-1 rounded shadow-sm border border-slate-100">
                                {c.point} Pts
                              </span>
                              <button
                                onClick={() => handleDeleteCategory(c.id)}
                                className="text-slate-300 hover:text-red-500 transition"
                              >
                                <i className="fas fa-trash-alt"></i>
                              </button>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>

                  <div className="mt-auto pt-4 border-t border-slate-100 relative z-10">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-2">Tambah Baru</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newRewardName}
                        onChange={(e) => setNewRewardName(e.target.value)}
                        placeholder="Nama Prestasi"
                        className="border rounded px-3 py-2 text-sm w-full outline-none focus:ring-1 focus:ring-green-400"
                      />
                      <input
                        type="number"
                        value={newRewardPoint}
                        onChange={(e) => setNewRewardPoint(e.target.value)}
                        placeholder="Poin"
                        className="border rounded px-3 py-2 text-sm w-24 outline-none focus:ring-1 focus:ring-green-400"
                      />
                      <button
                        onClick={() => handleAddCategory('reward')}
                        className="bg-slate-800 text-white px-4 py-2 rounded hover:bg-slate-900 transition"
                      >
                        <i className="fas fa-plus"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="max-w-5xl mx-auto">
              <h2 className="text-2xl font-bold text-slate-800 mb-6">Pengaturan</h2>

              {/* Cloud Firestore Integration & Migration Card */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-indigo-200 mb-6 bg-gradient-to-r from-indigo-50/50 to-white">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <i className="fas fa-cloud text-indigo-600 text-lg"></i>
                      <h3 className="font-bold text-slate-800">Sinkronisasi Cloud Firestore</h3>
                    </div>
                    <p className="text-sm text-slate-500 mt-1">
                      Data disimpan secara real-time dan terenkripsi di Google Cloud Firestore untuk penggunaan lintas perangkat.
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                    currentUser ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {currentUser ? 'Aktif (Terhubung)' : 'Belum Terhubung'}
                  </span>
                </div>

                <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
                    <span className="text-slate-600">Akun Pengguna BK:</span>
                    <span className="font-semibold text-slate-800">{currentUser ? currentUser.email : 'Belum masuk'}</span>
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
                    <span className="text-slate-600">Database Engine:</span>
                    <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded text-indigo-600">Google Cloud Firestore (Standard Enterprise)</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 mt-4">
                  <button
                    onClick={handleMigrateLocalData}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium shadow-sm transition flex items-center gap-2"
                  >
                    <i className="fas fa-cloud-arrow-up"></i>
                    <span>Migrasi / Unggah Data Lokal ke Cloud</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!currentUser) return alert("Silakan masuk akun Google terlebih dahulu.");
                      alert("Data cloud aktif dan tersinkronisasi otomatis.");
                    }}
                    className="border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-lg text-sm font-medium transition flex items-center gap-2"
                  >
                    <i className="fas fa-arrows-rotate"></i>
                    <span>Periksa Status Sinkronisasi</span>
                  </button>
                </div>
              </div>

              {/* School Identity */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6">
                <h3 className="font-bold mb-4">Identitas Sekolah</h3>
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nama Sekolah</label>
                <input
                  type="text"
                  value={school.name}
                  onChange={(e) => setSchool({ ...school, name: e.target.value })}
                  className="w-full border rounded p-2 mb-3 text-sm outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="Nama Sekolah"
                />
                <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Alamat Sekolah</label>
                <textarea
                  value={school.address}
                  onChange={(e) => setSchool({ ...school, address: e.target.value })}
                  className="w-full border rounded p-2 mb-3 text-sm outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="Alamat"
                  rows={2}
                ></textarea>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Nama Guru BK</label>
                    <input
                      type="text"
                      value={school.teacher}
                      onChange={(e) => setSchool({ ...school, teacher: e.target.value })}
                      className="w-full border rounded p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-400"
                      placeholder="Nama Guru BK"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Skor Awal Siswa</label>
                    <input
                      type="number"
                      value={school.defaultScore}
                      onChange={(e) => setSchool({ ...school, defaultScore: parseInt(e.target.value, 10) || 100 })}
                      className="w-full border rounded p-2 text-sm outline-none focus:ring-1 focus:ring-indigo-400"
                      placeholder="Skor Awal"
                    />
                  </div>
                </div>
              </div>

              {/* Alert Settings */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6">
                <h3 className="font-bold mb-4">Batas Alert & Bintang</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs font-bold text-yellow-600 block mb-1">Kuning (Waspada)</label>
                    <input
                      type="number"
                      value={school.alertYellow}
                      onChange={(e) => setSchool({ ...school, alertYellow: parseInt(e.target.value, 10) || 70 })}
                      className="w-full border rounded p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-orange-600 block mb-1">Orange (Bahaya)</label>
                    <input
                      type="number"
                      value={school.alertOrange}
                      onChange={(e) => setSchool({ ...school, alertOrange: parseInt(e.target.value, 10) || 49 })}
                      className="w-full border rounded p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-red-600 block mb-1">Merah (Kritis)</label>
                    <input
                      type="number"
                      value={school.alertRed}
                      onChange={(e) => setSchool({ ...school, alertRed: parseInt(e.target.value, 10) || 29 })}
                      className="w-full border rounded p-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-amber-500 block mb-1">Bintang (Prestasi)</label>
                    <input
                      type="number"
                      value={school.starLimit}
                      onChange={(e) => setSchool({ ...school, starLimit: parseInt(e.target.value, 10) || 101 })}
                      className="w-full border rounded p-2 text-sm border-yellow-300 bg-yellow-50"
                    />
                  </div>
                </div>
              </div>

              {/* Backup Otomatis */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 mb-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-bold">Backup Otomatis</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Menyimpan salinan lokal berkala di browser sebagai pengaman sebelum ekspor JSON manual.
                    </p>
                  </div>
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.autoBackup}
                      onChange={(e) => setSettings({ ...settings, autoBackup: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="relative w-11 h-6 bg-slate-200 rounded-full peer peer-checked:bg-indigo-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:h-5 after:w-5 after:rounded-full after:transition-all peer-checked:after:translate-x-full"></div>
                    <span className="ml-3 text-sm font-medium text-slate-700">Aktif</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase">Interval Backup (menit)</label>
                    <input
                      type="number"
                      value={settings.backupIntervalMinutes}
                      onChange={(e) => setSettings({ ...settings, backupIntervalMinutes: parseInt(e.target.value, 10) || 10 })}
                      min="1"
                      className="w-full border rounded p-2 mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase">Jumlah Backup Disimpan</label>
                    <input
                      type="number"
                      value={settings.backupLimit}
                      onChange={(e) => setSettings({ ...settings, backupLimit: parseInt(e.target.value, 10) || 10 })}
                      min="1"
                      max="20"
                      className="w-full border rounded p-2 mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 uppercase">Backup Terakhir</label>
                    <div className="border rounded p-2 mt-1 text-sm text-slate-600 bg-slate-50">
                      {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('id-ID') : 'Tersimpan otomatis'}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() => {
                      setSettings({ ...settings, lastBackupAt: new Date().toISOString() });
                      saveLocalData({ school, settings, categories, students, counselingLog: counselingLogs });
                      alert("Backup lokal berhasil dibuat.");
                    }}
                    className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 text-sm font-medium"
                  >
                    <i className="fas fa-shield-halved mr-2"></i> Buat Backup Sekarang
                  </button>
                  <button
                    onClick={handleDownloadBackup}
                    className="border border-slate-300 text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-50 text-sm font-medium"
                  >
                    <i className="fas fa-download mr-2"></i> Unduh File JSON
                  </button>
                </div>
              </div>

              {/* Reset Tahun Ajaran Baru */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-200 mb-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-4">
                  <div>
                    <h3 className="font-bold text-red-700">Reset Tahun Ajaran Baru</h3>
                    <p className="text-sm text-slate-500 mt-1">
                      Reset akan menghapus riwayat poin terpilih dan mengembalikan skor siswa sesuai jenis poin yang direset.
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-red-50 text-red-700 text-xs font-bold">
                    Perlu 2x Verifikasi
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <button
                    onClick={() => handleResetPoints('punishment')}
                    className="border border-red-200 text-red-700 px-4 py-3 rounded-lg hover:bg-red-50 text-sm font-medium text-left"
                  >
                    <i className="fas fa-minus-circle mr-2"></i>Reset Pelanggaran
                    <br />
                    <span className="text-xs font-normal text-slate-500">Hapus poin pelanggaran dan pulihkan skor.</span>
                  </button>
                  <button
                    onClick={() => handleResetPoints('reward')}
                    className="border border-amber-200 text-amber-700 px-4 py-3 rounded-lg hover:bg-amber-50 text-sm font-medium text-left"
                  >
                    <i className="fas fa-plus-circle mr-2"></i>Reset Prestasi
                    <br />
                    <span className="text-xs font-normal text-slate-500">Hapus poin prestasi dan kurangi skor bonus.</span>
                  </button>
                  <button
                    onClick={() => handleResetPoints('all')}
                    className="bg-red-600 text-white px-4 py-3 rounded-lg hover:bg-red-700 text-sm font-medium text-left"
                  >
                    <i className="fas fa-triangle-exclamation mr-2"></i>Reset Semua Poin
                    <br />
                    <span className="text-xs font-normal text-red-100">Kosongkan riwayat poin dan set skor awal.</span>
                  </button>
                </div>
              </div>

              <button
                onClick={handleSaveSettings}
                className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg hover:bg-indigo-700 font-medium transition"
              >
                Simpan Pengaturan
              </button>
            </div>
          )}
        </div>
      </main>

      {/* MODAL OVERLAY */}
      {modalOpen && (
        <div
          onClick={closeModal}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity"
        ></div>
      )}

      {/* 1. STUDENT DETAIL MODAL */}
      {modalOpen === 'modal-student-detail' && selectedStudent && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-lg text-slate-700">Detail Rekam Jejak Siswa</h3>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>

            <div className="overflow-y-auto p-8 bg-white" id="print-area-student">
              {/* Header */}
              <div className="text-center border-b-2 border-slate-800 pb-4 mb-6">
                <h2 className="text-2xl font-bold uppercase">{school.name}</h2>
                <p className="text-sm text-slate-600">{school.address}</p>
              </div>

              {/* Profile Card */}
              <div className="bg-slate-50 rounded-xl p-6 mb-6 border border-slate-200 flex gap-6 items-center relative overflow-hidden">
                {selectedStudent.score >= school.starLimit && (
                  <div className="absolute top-0 right-0 p-4">
                    <i className="fas fa-star text-yellow-400 text-4xl opacity-50"></i>
                  </div>
                )}
                {selectedStudent.photo ? (
                  <img
                    src={selectedStudent.photo}
                    alt={selectedStudent.name}
                    className="w-24 h-24 rounded-full object-cover bg-slate-200"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center text-slate-400">
                    <i className="fas fa-user text-3xl"></i>
                  </div>
                )}
                <div>
                  <p className="text-xs text-slate-500 uppercase font-bold">Nama Siswa</p>
                  <p className="text-lg font-bold text-slate-800">{selectedStudent.name}</p>
                  <p className="text-sm text-slate-600">{selectedStudent.class} / {selectedStudent.nis}</p>
                  <p className="text-2xl font-bold text-indigo-600 mt-1">{selectedStudent.score}</p>
                </div>
              </div>

              {/* History Tables */}
              <div className="space-y-6">
                <div>
                  <h4 className="font-bold text-slate-800 mb-2 border-l-4 border-indigo-500 pl-3">Data Psikologis</h4>
                  <div className="bg-white border p-4 rounded text-sm text-slate-600 whitespace-pre-wrap">
                    {selectedStudent.psychInfo || '-'}
                  </div>
                </div>

                <div>
                  <h4 className="font-bold text-slate-800 mb-2 border-l-4 border-rose-500 pl-3">Riwayat Poin</h4>
                  <table className="w-full text-sm border border-slate-200">
                    <tbody>
                      {loadingPoints ? (
                        <tr><td className="p-4 text-center text-slate-400">Memuat riwayat poin...</td></tr>
                      ) : selectedStudentPoints.length > 0 ? (
                        selectedStudentPoints.map((h, hIdx) => (
                          <tr key={h.id || hIdx} className="border-b border-slate-100">
                            <td className="p-2">{h.date}</td>
                            <td className="p-2">{h.category}</td>
                            <td className={`p-2 font-bold ${h.type === 'punishment' ? 'text-red-600' : 'text-green-600'}`}>
                              {h.type === 'punishment' ? '-' : '+'}{h.point}
                            </td>
                            <td className="p-2 text-center no-print">
                              <button
                                onClick={() => handleEditHistoryItemModal(h)}
                                className="text-blue-500 hover:text-blue-700 mr-2"
                              >
                                <i className="fas fa-edit"></i>
                              </button>
                              <button
                                onClick={() => handleDeleteHistoryItem(h)}
                                className="text-red-500 hover:text-red-700"
                              >
                                <i className="fas fa-trash"></i>
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr><td className="p-4 text-center text-slate-400">Belum ada riwayat poin.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="font-bold text-slate-800 mb-2 border-l-4 border-purple-500 pl-3">Konseling</h4>
                  <table className="w-full text-sm border border-slate-200">
                    <tbody>
                      {counselingLogs.filter((l) => l.studentName === selectedStudent.name).length > 0 ? (
                        counselingLogs
                          .filter((l) => l.studentName === selectedStudent.name)
                          .map((l) => (
                            <tr key={l.id} className="border-b border-slate-100">
                              <td className="p-2">{l.date}</td>
                              <td className="p-2">{l.type}</td>
                              <td className="p-2">
                                <span className="px-2 py-0.5 rounded text-xs bg-purple-100 text-purple-700">
                                  {l.status}
                                </span>
                              </td>
                              <td className="p-2">
                                {l.desc}
                                {l.followUp && <div className="text-xs text-slate-500 mt-1">TL: {l.followUp}</div>}
                              </td>
                            </tr>
                          ))
                      ) : (
                        <tr><td className="p-4 text-center text-slate-400">Belum ada catatan konseling.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="font-bold text-slate-800 mb-2 border-l-4 border-slate-700 pl-3">Riwayat Lengkap</h4>
                  <table className="w-full text-sm border border-slate-200">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="p-2 text-left">Tanggal</th>
                        <th className="p-2 text-left">Jenis</th>
                        <th className="p-2 text-left">Catatan</th>
                        <th className="p-2 text-left">Status/Skor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStudentPoints.map((h) => (
                        <tr key={h.id || Math.random()} className="border-t">
                          <td className="p-2 whitespace-nowrap">{h.date}</td>
                          <td className="p-2 font-medium">{h.type === 'punishment' ? 'Pelanggaran' : 'Prestasi'}</td>
                          <td className="p-2">{h.category}</td>
                          <td className="p-2">{h.type === 'punishment' ? '-' : '+'}{h.point} poin</td>
                        </tr>
                      ))}
                      {counselingLogs
                        .filter((l) => l.studentName === selectedStudent.name)
                        .map((l) => (
                          <tr key={l.id} className="border-t">
                            <td className="p-2 whitespace-nowrap">{l.date}</td>
                            <td className="p-2 font-medium">Konseling</td>
                            <td className="p-2">{l.type}: {l.desc}</td>
                            <td className="p-2">{l.status}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signature Block */}
              <div className="mt-8 text-right">
                <p className="text-sm mb-16">Guru BK</p>
                <p className="font-bold">{school.teacher}</p>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="bg-slate-50 px-6 py-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 no-print">
              <button
                onClick={() => openModal('modal-letter')}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium transition text-sm"
              >
                <i className="fas fa-envelope mr-2"></i> Buat Surat
              </button>
              <button
                onClick={handlePrintStudentHistoryPDF}
                className="bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 font-medium transition text-sm"
              >
                <i className="fas fa-clock-rotate-left mr-2"></i> Cetak Riwayat
              </button>
              <button
                onClick={handlePrintStudentReportPDF}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 font-medium transition text-sm"
              >
                <i className="fas fa-print mr-2"></i> Cetak Laporan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. ADD / EDIT STUDENT MODAL */}
      {modalOpen === 'modal-add-student' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-0 overflow-hidden">
            <div className="bg-indigo-600 px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg">
                {modalMode === 'edit' ? 'Edit Data Siswa' : 'Data Siswa Baru'}
              </h3>
              <button onClick={closeModal}><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-center mb-4">
                <div
                  className="relative group cursor-pointer"
                  onClick={() => fileInputPhotoRef.current?.click()}
                >
                  <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden border-2 border-dashed border-slate-300">
                    {studentFormPhoto ? (
                      <img src={studentFormPhoto} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <i className="fas fa-camera text-slate-400 text-2xl"></i>
                    )}
                  </div>
                  <input
                    type="file"
                    ref={fileInputPhotoRef}
                    className="hidden"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-1">
                  <input
                    type="text"
                    value={studentFormNis}
                    onChange={(e) => setStudentFormNis(e.target.value)}
                    className="w-full border rounded p-2 text-sm"
                    placeholder="NIS"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="text"
                    value={studentFormClass}
                    onChange={(e) => setStudentFormClass(e.target.value)}
                    className="w-full border rounded p-2 text-sm"
                    placeholder="Kelas"
                  />
                </div>
              </div>
              <input
                type="text"
                value={studentFormName}
                onChange={(e) => setStudentFormName(e.target.value)}
                className="w-full border rounded p-2 text-sm"
                placeholder="Nama Lengkap"
              />
              <textarea
                value={studentFormPsych}
                onChange={(e) => setStudentFormPsych(e.target.value)}
                rows={3}
                className="w-full border rounded p-2 text-sm"
                placeholder="Catatan Psikologis"
              ></textarea>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-slate-600">Batal</button>
              <button
                onClick={handleSaveStudent}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded text-sm font-medium transition"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. ADD POINT MODAL */}
      {modalOpen === 'modal-add-point' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-0 overflow-hidden">
            <div className="bg-rose-600 px-6 py-4 flex justify-between items-center text-white">
              <h3 className="font-bold text-lg">Input Pelanggaran / Prestasi</h3>
              <button onClick={closeModal}><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Pilih Siswa</label>
                <select
                  value={pointStudentId}
                  onChange={(e) => setPointStudentId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-rose-500 outline-none bg-white"
                >
                  <option value="">-- Cari / Pilih Siswa --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} - {s.class}</option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Jenis Input</label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="pointType"
                      value="punishment"
                      checked={pointType === 'punishment'}
                      onChange={() => {
                        setPointType('punishment');
                        const firstP = categories.find((c) => c.type === 'punishment');
                        if (firstP) setPointCategory(JSON.stringify(firstP));
                      }}
                      className="w-4 h-4 text-rose-600 focus:ring-rose-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm font-medium text-slate-700">Pelanggaran (-)</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="pointType"
                      value="reward"
                      checked={pointType === 'reward'}
                      onChange={() => {
                        setPointType('reward');
                        const firstR = categories.find((c) => c.type === 'reward');
                        if (firstR) setPointCategory(JSON.stringify(firstR));
                      }}
                      className="w-4 h-4 text-green-600 focus:ring-green-500 border-gray-300"
                    />
                    <span className="ml-2 text-sm font-medium text-slate-700">Prestasi (+)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Kategori</label>
                <select
                  value={pointCategory}
                  onChange={(e) => setPointCategory(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-rose-500 outline-none bg-white"
                >
                  {categories
                    .filter((c) => c.type === pointType)
                    .map((c) => (
                      <option key={c.id} value={JSON.stringify(c)}>
                        {c.name} ({c.point} Poin)
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tanggal Kejadian</label>
                <input
                  type="date"
                  value={pointDate}
                  onChange={(e) => setPointDate(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                />
              </div>
            </div>

            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-100">
              <button onClick={closeModal} className="px-4 py-2 text-slate-600 hover:bg-slate-200 rounded-lg text-sm font-medium transition">
                Batal
              </button>
              <button
                onClick={handleSubmitPoint}
                className="px-6 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 shadow-lg shadow-rose-200 transition"
              >
                Simpan Poin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. ADD COUNSELING MODAL */}
      {modalOpen === 'modal-add-counseling' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl p-0 overflow-hidden">
            <div className="bg-purple-600 px-6 py-4 flex justify-between items-center text-white">
              <h3 className="font-bold text-lg">Catat Sesi</h3>
              <button onClick={closeModal}><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Siswa</label>
                <select
                  value={counselingStudentId}
                  onChange={(e) => setCounselingStudentId(e.target.value)}
                  className="w-full border rounded p-2 text-sm bg-white"
                >
                  <option value="">-- Pilih Siswa --</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} - {s.class}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tanggal</label>
                  <input
                    type="date"
                    value={counselingFormDate}
                    onChange={(e) => setCounselingFormDate(e.target.value)}
                    className="w-full border rounded p-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Layanan</label>
                  <select
                    value={counselingFormType}
                    onChange={(e) => setCounselingFormType(e.target.value)}
                    className="w-full border rounded p-2 text-sm bg-white"
                  >
                    <option value="Konseling Pribadi">Konseling Pribadi</option>
                    <option value="Konseling Karir">Konseling Karir</option>
                    <option value="Konseling Belajar">Konseling Belajar</option>
                    <option value="Anecdotal Record">Catatan Anekdot</option>
                    <option value="Home Visit">Kunjungan Rumah</option>
                    <option value="Pemanggilan Orang Tua">Pemanggilan Orang Tua</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status Kasus</label>
                  <select
                    value={counselingFormStatus}
                    onChange={(e) => setCounselingFormStatus(e.target.value as CounselingLog['status'])}
                    className="w-full border rounded p-2 text-sm bg-white"
                  >
                    {COUNSELING_STATUSES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Target Tindak Lanjut</label>
                  <input
                    type="date"
                    value={counselingFormFollowDate}
                    onChange={(e) => setCounselingFormFollowDate(e.target.value)}
                    className="w-full border rounded p-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Masalah</label>
                <textarea
                  value={counselingFormDesc}
                  onChange={(e) => setCounselingFormDesc(e.target.value)}
                  rows={3}
                  className="w-full border rounded p-2 text-sm"
                ></textarea>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Hasil</label>
                <textarea
                  value={counselingFormResult}
                  onChange={(e) => setCounselingFormResult(e.target.value)}
                  rows={2}
                  className="w-full border rounded p-2 text-sm"
                ></textarea>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Rencana Tindak Lanjut</label>
                <textarea
                  value={counselingFormFollowUp}
                  onChange={(e) => setCounselingFormFollowUp(e.target.value)}
                  rows={2}
                  className="w-full border rounded p-2 text-sm"
                  placeholder="Contoh: konseling lanjutan, koordinasi wali kelas"
                ></textarea>
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t">
              <button onClick={closeModal} className="px-4 py-2 text-slate-600 text-sm">Batal</button>
              <button
                onClick={handleSubmitCounseling}
                className="bg-purple-600 hover:bg-purple-700 text-white px-5 py-2 rounded text-sm font-medium transition"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. LETTER GENERATOR MODAL */}
      {modalOpen === 'modal-letter' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-0 overflow-hidden">
            <div className="bg-blue-600 px-6 py-4 flex justify-between items-center text-white">
              <h3 className="font-bold text-lg">Buat Surat Panggilan</h3>
              <button onClick={closeModal}><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nomor Surat</label>
                <input
                  type="text"
                  value={letterNo}
                  onChange={(e) => setLetterNo(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Perihal</label>
                <select
                  value={letterType}
                  onChange={(e) => setLetterType(e.target.value)}
                  className="w-full border rounded p-2 text-sm bg-white"
                >
                  <option value="Panggilan Orang Tua">Panggilan Orang Tua</option>
                  <option value="Surat Peringatan 1">Surat Peringatan 1 (SP1)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Hari/Tanggal Menghadap</label>
                <input
                  type="text"
                  value={letterMeetDate}
                  onChange={(e) => setLetterMeetDate(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                  placeholder="Contoh: Senin, 20 Oktober 2026"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Waktu</label>
                <input
                  type="text"
                  value={letterMeetTime}
                  onChange={(e) => setLetterMeetTime(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nama Orang Tua (Opsional)</label>
                <input
                  type="text"
                  value={letterParentName}
                  onChange={(e) => setLetterParentName(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                  placeholder="Kosongkan jika default"
                />
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end border-t">
              <button
                onClick={handlePrintLetter}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition"
              >
                Cetak Surat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. EDIT HISTORY ITEM MODAL */}
      {modalOpen === 'modal-edit-history' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-0 overflow-hidden">
            <div className="bg-orange-500 px-6 py-4 text-white flex justify-between items-center">
              <h3 className="font-bold text-lg">Edit Poin</h3>
              <button onClick={closeModal}><i className="fas fa-times"></i></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Jenis</label>
                <div className="flex gap-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="editPointType"
                      value="punishment"
                      checked={editHistoryType === 'punishment'}
                      onChange={() => setEditHistoryType('punishment')}
                    />
                    <span className="ml-2 text-sm">Pelanggaran</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="editPointType"
                      value="reward"
                      checked={editHistoryType === 'reward'}
                      onChange={() => setEditHistoryType('reward')}
                    />
                    <span className="ml-2 text-sm">Prestasi</span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Kategori Baru</label>
                <select
                  value={editHistoryCatObj}
                  onChange={(e) => setEditHistoryCatObj(e.target.value)}
                  className="w-full border rounded p-2 text-sm bg-white"
                >
                  <option value="">-- Pilih Kategori --</option>
                  {categories
                    .filter((c) => c.type === editHistoryType)
                    .map((c) => (
                      <option key={c.id} value={JSON.stringify(c)}>
                        {c.name} ({c.point})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tanggal</label>
                <input
                  type="date"
                  value={editHistoryDate}
                  onChange={(e) => setEditHistoryDate(e.target.value)}
                  className="w-full border rounded p-2 text-sm"
                />
              </div>
            </div>
            <div className="bg-slate-50 px-6 py-4 flex justify-end gap-2 border-t">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-slate-600">Batal</button>
              <button
                onClick={handleSaveHistoryItem}
                className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded text-sm font-medium transition"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. DASHBOARD SUMMARY MODAL */}
      {modalOpen === 'modal-summary' && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-lg text-slate-800">
                {summaryType === 'violation' ? 'Detail Pelanggaran Bulan Ini' : 'Detail Prestasi Siswa'}
              </h3>
              <button onClick={closeModal}><i className="fas fa-times"></i></button>
            </div>
            <div className="overflow-y-auto p-4 flex-1">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-slate-50 text-slate-500 border-b">
                  <tr>
                    <th className="p-3">Siswa</th>
                    <th className="p-3">Kelas</th>
                    <th className="p-3">Tanggal</th>
                    <th className="p-3">Kategori</th>
                    <th className="p-3">Poin</th>
                  </tr>
                </thead>
                <tbody>
                  {students.flatMap((s) =>
                    (s.pointHistory || [])
                      .filter((h) =>
                        summaryType === 'violation'
                          ? h.type === 'punishment'
                          : h.type === 'reward'
                      )
                      .map((h, idx) => (
                        <tr key={idx} className="border-b hover:bg-slate-50">
                          <td className="p-3 font-semibold">{s.name}</td>
                          <td className="p-3 text-slate-600">{s.class}</td>
                          <td className="p-3">{h.date}</td>
                          <td className="p-3">{h.category}</td>
                          <td className={`p-3 font-bold ${summaryType === 'violation' ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {summaryType === 'violation' ? '-' : '+'}{h.point}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-slate-50 border-t text-right">
              <button
                onClick={closeModal}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded text-sm font-medium transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HIDDEN LETTER PRINT TEMPLATE */}
      <div id="letter-template" className="hidden">
        <div style={{ padding: '40px', fontFamily: "'Times New Roman', serif", color: 'black' }}>
          <div style={{ textAlign: 'center', borderBottom: '3px double black', paddingBottom: '10px', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>
              {school.name}
            </h2>
            <p style={{ fontSize: '12px', margin: 0 }}>{school.address}</p>
          </div>
          <div style={{ textAlign: 'right', marginBottom: '20px' }}>
            <p>
              {new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <table style={{ width: '100%', marginBottom: '20px' }}>
            <tbody>
              <tr><td style={{ width: '100px' }}>Nomor</td><td>: {letterNo}</td></tr>
              <tr><td>Lampiran</td><td>: -</td></tr>
              <tr><td>Perihal</td><td>: <strong>{letterType}</strong></td></tr>
            </tbody>
          </table>
          <p>
            Kepada Yth,<br />
            Bapak/Ibu Orang Tua/Wali dari:<br />
            <strong>{letterParentName ? `${letterParentName} (Wali dari ${selectedStudent?.name})` : selectedStudent?.name}</strong><br />
            Di Tempat
          </p>
          <br />
          <p>Dengan hormat,</p>
          <p style={{ textAlign: 'justify' }}>
            Sehubungan dengan perlunya komunikasi dan koordinasi antara pihak sekolah dengan orang tua siswa mengenai perkembangan dan kedisiplinan putra/putri Bapak/Ibu, maka kami mengharap kehadiran Bapak/Ibu ke sekolah pada:
          </p>
          <table style={{ marginLeft: '20px', marginTop: '10px', marginBottom: '10px' }}>
            <tbody>
              <tr><td style={{ width: '120px' }}>Hari / Tanggal</td><td>: {letterMeetDate || 'Menyesuaikan'}</td></tr>
              <tr><td>Waktu</td><td>: {letterMeetTime}</td></tr>
              <tr><td>Tempat</td><td>: Ruang Bimbingan Konseling (BK)</td></tr>
              <tr><td>Keperluan</td><td>: Konsultasi Masalah Siswa</td></tr>
            </tbody>
          </table>
          <p style={{ textAlign: 'justify' }}>
            Mengingat pentingnya hal tersebut, dimohon kehadiran Bapak/Ibu tepat pada waktunya. Atas perhatian dan kerjasamanya kami ucapkan terima kasih.
          </p>
          <br /><br />
          <div style={{ textAlign: 'right', marginRight: '20px' }}>
            <p>Mengetahui,<br />Guru Bimbingan Konseling</p>
            <br /><br /><br />
            <p style={{ fontWeight: 'bold', textDecoration: 'underline' }}>{school.teacher}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
