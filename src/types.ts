export interface SchoolConfig {
  name: string;
  address: string;
  teacher: string;
  defaultScore: number;
  alertRed: number;
  alertOrange: number;
  alertYellow: number;
  starLimit: number;
  updatedAt?: string;
}

export interface AppSettings {
  autoBackup: boolean;
  backupIntervalMinutes: number;
  backupLimit: number;
  lastBackupAt: string | null;
}

export interface PointCategory {
  id: string;
  type: 'punishment' | 'reward';
  name: string;
  point: number;
  createdAt?: string;
}

export interface PointHistoryItem {
  id?: string;
  date: string;
  category: string;
  type: 'punishment' | 'reward';
  point: number;
  studentId?: string;
  loggedBy?: string;
  createdAt?: string;
}

export interface Student {
  id: string;
  nis: string;
  name: string;
  class: string;
  psychInfo: string;
  score: number;
  photo: string | null;
  pointHistory?: PointHistoryItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface CounselingLog {
  id: string;
  date: string;
  studentId?: string;
  studentName: string;
  studentClass: string;
  type: string;
  status: 'Baru' | 'Diproses' | 'Perlu Panggilan Orang Tua' | 'Monitoring' | 'Selesai';
  desc: string;
  result: string;
  followUp: string;
  followDate: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AppData {
  school: SchoolConfig;
  settings: AppSettings;
  categories: PointCategory[];
  students: Student[];
  counselingLog: CounselingLog[];
}
