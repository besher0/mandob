// Exact mandob-v2 dashboard contract; the adapter lives in App.tsx.
export type Named = {id:string;name:string};
export type DoctorProgress = { uniqueDoctors: number; assignments: number; unvisited: number; incomplete: number; complete: number };
export type ManagerRep = Named & {
  status: string;
  teamIds: string[];
  areas: Named[];
  requiredVisits: number;
  completedVisits: number;
  coverage: number;
  lastVisit: string | null;
  scopeConfigured: boolean;
  doctorProgress: DoctorProgress;
};
export type ManagerTarget = Named & {
  key: string;
  lastVisit: string | null;
  remainingVisits: number;
  progressStatus: "UNVISITED" | "INCOMPLETE" | "COMPLETE";
  type: string;
  repId: string;
  repName: string;
  teamId: string;
  teamName: string;
  classCode: string;
  specialtyId?: string | null;
  specialties: string[];
  areas: Named[];
  requiredVisits: number;
  completedVisits: number;
  coverage: number;
};
export type ManagerVisit = {
  id: string;
  targetName: string;
  type: string;
  products: Named[];
};
export type ManagerRound = {
  registrationLocation?: {status:string;latitude?:number;longitude?:number;accuracy?:number;capturedAt?:string;reason?:string} | null;
  id: string;
  repId: string;
  repName: string;
  date: string;
  type: string;
  areas: Named[];
  visits: ManagerVisit[];
};
export type ManagerWorkspace = {
  teams: (Named & {
    province: Named | null;
    specialties: Named[];
    products: Named[];
    repCount: number;
    doctorProgress: DoctorProgress;
    coverage: number;
  })[];
  cycle: null | (Named & { startsOn: string; endsOn: string });
  today: string;
  reps: ManagerRep[];
  targets: ManagerTarget[];
  areas: (Named & {
    coverage: number;
    targets: number;
    repNames: string[];
    counts: {
      reps: number;
      doctors: number;
      pharmacies: number;
      hospitals: number;
    };
    reps: (Named & {
      coverage: number;
      requiredVisits: number;
      creditedVisits: number;
      doctors: number;
      visitedDoctors: number;
    })[];
  })[];
  products: (Named & { promotions: number; genericName: string | null })[];
  rounds: ManagerRound[];
  week: { date: string; count: number }[];
  summary: {
    visitsToday: number;
    areaCoverage: number;
    lowCoverageAreas: number;
    averageRepCoverage: number;
    pendingReports: number | null;
    overdueVisits: number | null;
    reps: number;
    visits: number;
    coverage: number;
    doctors: number;
    reports: number;
    pendingLeaves: number;
    remainingVisits: number;
  };
  unconfiguredPeriods: number;
  settings: {
    roundEditWindowHours: number;
    frequency: { id: string; code: string; requiredVisits: number }[];
    annualLeaveDays: number | null;
    workingDays: {
      weekday: number;
      isWorking: boolean;
      workloadFactor: number;
    }[];
  };
};
export type ManagerReport = {
  reportId: string;
  teamId: string;
  team: { name: string };
  snapshot: {
    from: string;
    to: string;
    total: number;
    doctors: number;
    pharmacies: number;
    hospitals: number;
    averagePerDay: number;
    attributionComplete?: boolean;
  };
  report: {
    createdAt: string;
    rep: Named;
    period: string;
    startsOn: string;
    endsOn: string;
  };
};
export type ManagerLeave = {
  id: string;
  type: string | null;
  startsOn: string;
  endsOn: string;
  requestedDays: number;
  reason: string | null;
  status: string;
  reviewNote: string | null;
  requester: Named;
  attachment: Named | null;
};
