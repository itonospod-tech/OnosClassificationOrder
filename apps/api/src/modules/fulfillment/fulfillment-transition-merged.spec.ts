import type { FulfillmentStages, FulfillmentStageState, FulfillmentTimelineEntry } from 'shared';
import {
  FactoryFlowType,
  FulfillmentStage,
  FulfillmentStageStatus,
  FulfillmentTransitionAction,
  redirectAutoTarget,
} from 'shared';

import type { UserDocument } from '../user/user.entity';
import { FulfillmentTaskService } from './fulfillment-task.service';

/**
 * Luồng rút gọn theo xưởng (`FactoryEntity.flowType`): `merged` (xưởng gỗ —
 * In+Ép, May vào+May ra) và `no-sew` (Mê Linh — QC xong bỏ qua 2 công đoạn
 * may, dừng ở Đóng hàng). Test thẳng `resolveTransition` (pure: chỉ build
 * patch, không đụng Mongo) bằng cách instantiate service với deps null. Nếu
 * constructor thêm dep mới chỉ cần thêm null tương ứng.
 */
const svc = new FulfillmentTaskService(
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
);

type TransitionInput = {
  stage: FulfillmentStage;
  action: FulfillmentTransitionAction;
  currentStatus: FulfillmentStageStatus;
  stageState: FulfillmentStageState;
  target?: 'designer' | FulfillmentStage;
  reason?: string;
  stages: FulfillmentStages;
  user: UserDocument;
  flowType?: FactoryFlowType;
  autoPack?: boolean;
};
type TransitionPlan = {
  nextStatus: FulfillmentStageStatus;
  patch: {
    $set: Record<string, unknown>;
    $inc?: Record<string, number>;
    $push: { fulfillmentTimeline: { $each: FulfillmentTimelineEntry[] } | FulfillmentTimelineEntry };
  };
};
const resolve = (input: TransitionInput): TransitionPlan =>
  (svc as unknown as { resolveTransition: (i: TransitionInput) => TransitionPlan }).resolveTransition(input);

const worker = { _id: 'worker-1', fullName: 'Worker In' } as unknown as UserDocument;

const inProgress = (startedAt?: Date): FulfillmentStageState => ({
  status: FulfillmentStageStatus.InProgress,
  reworkCount: 0,
  workMs: 0,
  startedAt,
});

const timelineEntries = (plan: TransitionPlan): FulfillmentTimelineEntry[] => {
  const pushed = plan.patch.$push.fulfillmentTimeline;
  return '$each' in pushed ? pushed.$each : [pushed];
};

describe('redirectAutoTarget — đích rework trên xưởng luồng rút gọn', () => {
  it('merged: stage gộp về stage gốc — press→print, sew-out→sew-in', () => {
    expect(redirectAutoTarget(FactoryFlowType.Merged, FulfillmentStage.Press)).toBe(FulfillmentStage.Print);
    expect(redirectAutoTarget(FactoryFlowType.Merged, FulfillmentStage.SewOut)).toBe(FulfillmentStage.SewIn);
  });

  it('merged: stage thường giữ nguyên', () => {
    expect(redirectAutoTarget(FactoryFlowType.Merged, FulfillmentStage.Print)).toBe(FulfillmentStage.Print);
    expect(redirectAutoTarget(FactoryFlowType.Merged, FulfillmentStage.QCPostPress)).toBe(FulfillmentStage.QCPostPress);
    expect(redirectAutoTarget(FactoryFlowType.Merged, FulfillmentStage.Pack)).toBe(FulfillmentStage.Pack);
  });

  it('no-sew: May vào/May ra đều lùi về QC sau ép (walk qua 2 auto-stage liên tiếp)', () => {
    expect(redirectAutoTarget(FactoryFlowType.NoSew, FulfillmentStage.SewIn)).toBe(FulfillmentStage.QCPostPress);
    expect(redirectAutoTarget(FactoryFlowType.NoSew, FulfillmentStage.SewOut)).toBe(FulfillmentStage.QCPostPress);
    expect(redirectAutoTarget(FactoryFlowType.NoSew, FulfillmentStage.Press)).toBe(FulfillmentStage.Press);
  });

  it('standard: mọi target giữ nguyên', () => {
    expect(redirectAutoTarget(FactoryFlowType.Standard, FulfillmentStage.Press)).toBe(FulfillmentStage.Press);
    expect(redirectAutoTarget(FactoryFlowType.Standard, FulfillmentStage.SewOut)).toBe(FulfillmentStage.SewOut);
  });
});

describe('Complete trên xưởng merged — auto-complete stage gộp', () => {
  it('In xong → Ép tự Done đủ timestamp, đơn nhảy thẳng QC', () => {
    const plan = resolve({
      stage: FulfillmentStage.Print,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(new Date(Date.now() - 60_000)),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Merged,
    });

    const set = plan.patch.$set;
    expect(set['fulfillmentStages.print.status']).toBe(FulfillmentStageStatus.Done);
    expect(set['fulfillmentStages.press.status']).toBe(FulfillmentStageStatus.Done);
    // Đủ timestamp để duration = 0 thay vì NaN ở SLA/lifecycle.
    for (const field of ['waitingAt', 'startedAt', 'firstStartedAt', 'completedAt', 'assignedAt']) {
      expect(set[`fulfillmentStages.press.${field}`]).toBeInstanceOf(Date);
    }
    expect(set['fulfillmentStages.press.assignee']).toBe('worker-1');
    // State press chưa init → counter mặc định.
    expect(set['fulfillmentStages.press.workMs']).toBe(0);
    expect(set['fulfillmentStages.press.reworkCount']).toBe(0);
    // Nhảy thẳng QC, không dừng ở Ép.
    expect(set.currentFulfillmentStage).toBe(FulfillmentStage.QCPostPress);
    expect(set['fulfillmentStages.qc-post-press.status']).toBe(FulfillmentStageStatus.Waiting);

    // Timeline 2 entry: print complete + press auto-complete (ghi vết người In).
    const entries = timelineEntries(plan);
    expect(entries).toHaveLength(2);
    expect(entries[1].stage).toBe(FulfillmentStage.Press);
    expect(entries[1].toStatus).toBe(FulfillmentStageStatus.Done);
    expect(entries[1].byUserId).toBe('worker-1');
  });

  it('May vào xong → May ra tự Done, đơn nhảy thẳng Đóng hàng', () => {
    const plan = resolve({
      stage: FulfillmentStage.SewIn,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Merged,
    });
    const set = plan.patch.$set;
    expect(set['fulfillmentStages.sew-out.status']).toBe(FulfillmentStageStatus.Done);
    expect(set.currentFulfillmentStage).toBe(FulfillmentStage.Pack);
    expect(set.fulfillmentCompletedAt).toBeUndefined();
  });

  it('vòng rework: Ép từng Done → auto-complete lại đánh dấu làm lại (reworkAt + $inc reworkCount)', () => {
    const plan = resolve({
      stage: FulfillmentStage.Print,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {
        press: {
          status: FulfillmentStageStatus.Done,
          reworkCount: 0,
          workMs: 0,
          completedAt: new Date(Date.now() - 3_600_000),
        },
      } as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Merged,
    });
    const set = plan.patch.$set;
    expect(set['fulfillmentStages.press.reworkAt']).toBeInstanceOf(Date);
    expect(plan.patch.$inc?.['fulfillmentStages.press.reworkCount']).toBe(1);
    // KHÔNG $set đè reworkCount khi đã $inc — Mongo cấm set+inc cùng path.
    expect(set['fulfillmentStages.press.reworkCount']).toBeUndefined();
  });

  it('xưởng thường (flowType=standard): In xong dừng ở Ép như cũ', () => {
    const plan = resolve({
      stage: FulfillmentStage.Print,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Standard,
    });
    const set = plan.patch.$set;
    expect(set.currentFulfillmentStage).toBe(FulfillmentStage.Press);
    expect(set['fulfillmentStages.press.status']).toBe(FulfillmentStageStatus.Waiting);
    expect(set['fulfillmentStages.press.completedAt']).toBeUndefined();
    expect(timelineEntries(plan)).toHaveLength(1);
  });

  it('Complete trực tiếp trên Ép (admin override cứu đơn kẹt) vẫn advance bình thường', () => {
    const plan = resolve({
      stage: FulfillmentStage.Press,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Merged,
    });
    // QC không phải auto-stage của merged → không auto-complete gì thêm.
    expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.QCPostPress);
    expect(timelineEntries(plan)).toHaveLength(1);
  });
});

describe('Complete trên xưởng no-sew (Mê Linh) — QC xong bỏ qua 2 công đoạn may', () => {
  it('QC xong → May vào + May ra tự Done cùng lúc, đơn chờ ở Đóng hàng (chưa hoàn tất flow)', () => {
    const plan = resolve({
      stage: FulfillmentStage.QCPostPress,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.NoSew,
    });

    const set = plan.patch.$set;
    for (const stg of ['sew-in', 'sew-out']) {
      expect(set[`fulfillmentStages.${stg}.status`]).toBe(FulfillmentStageStatus.Done);
      expect(set[`fulfillmentStages.${stg}.assignee`]).toBe('worker-1');
      expect(set[`fulfillmentStages.${stg}.workMs`]).toBe(0);
      for (const field of ['waitingAt', 'startedAt', 'firstStartedAt', 'completedAt']) {
        expect(set[`fulfillmentStages.${stg}.${field}`]).toBeInstanceOf(Date);
      }
    }
    // Dừng CHỜ ở Đóng hàng — pack KHÔNG tự done, flow chưa kết thúc.
    expect(set.currentFulfillmentStage).toBe(FulfillmentStage.Pack);
    expect(set['fulfillmentStages.pack.status']).toBe(FulfillmentStageStatus.Waiting);
    expect(set.fulfillmentCompletedAt).toBeUndefined();

    // Timeline 3 entry: qc complete + sew-in + sew-out auto.
    const entries = timelineEntries(plan);
    expect(entries).toHaveLength(3);
    expect(entries[1].stage).toBe(FulfillmentStage.SewIn);
    expect(entries[2].stage).toBe(FulfillmentStage.SewOut);
  });

  it('In/Ép vẫn tuần tự bình thường (không auto ở nửa đầu flow)', () => {
    const plan = resolve({
      stage: FulfillmentStage.Print,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.NoSew,
    });
    expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.Press);
    expect(timelineEntries(plan)).toHaveLength(1);
  });

  it('Đóng hàng vẫn xác nhận tay → complete pack mới kết thúc flow', () => {
    const plan = resolve({
      stage: FulfillmentStage.Pack,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.NoSew,
    });
    expect(plan.patch.$set.currentFulfillmentStage).toBeNull();
    expect(plan.patch.$set.fulfillmentCompletedAt).toBeInstanceOf(Date);
  });
});

describe('Toggle autoCompletePack — Đóng hàng tự hoàn thành (độc lập flowType)', () => {
  it('standard + toggle ON: May ra xong → Đóng hàng tự Done, flow KẾT THÚC luôn', () => {
    const plan = resolve({
      stage: FulfillmentStage.SewOut,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Standard,
      autoPack: true,
    });

    const set = plan.patch.$set;
    expect(set['fulfillmentStages.pack.status']).toBe(FulfillmentStageStatus.Done);
    expect(set['fulfillmentStages.pack.assignee']).toBe('worker-1');
    for (const field of ['waitingAt', 'startedAt', 'firstStartedAt', 'completedAt']) {
      expect(set[`fulfillmentStages.pack.${field}`]).toBeInstanceOf(Date);
    }
    expect(set.currentFulfillmentStage).toBeNull();
    expect(set.fulfillmentCompletedAt).toBeInstanceOf(Date);
    // Timeline phân biệt nguồn auto: toggle chứ không phải luồng rút gọn.
    const entries = timelineEntries(plan);
    expect(entries).toHaveLength(2);
    expect(entries[1].stage).toBe(FulfillmentStage.Pack);
    expect(entries[1].reason).toContain('tự xong Đóng hàng');
  });

  it('no-sew + toggle ON: QC xong → May vào + May ra + Đóng hàng tự Done cùng lúc, flow kết thúc', () => {
    const plan = resolve({
      stage: FulfillmentStage.QCPostPress,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.NoSew,
      autoPack: true,
    });
    const set = plan.patch.$set;
    for (const stg of ['sew-in', 'sew-out', 'pack']) {
      expect(set[`fulfillmentStages.${stg}.status`]).toBe(FulfillmentStageStatus.Done);
    }
    expect(set.currentFulfillmentStage).toBeNull();
    expect(set.fulfillmentCompletedAt).toBeInstanceOf(Date);
    expect(timelineEntries(plan)).toHaveLength(4);
  });

  it('toggle OFF: May ra xong vẫn dừng CHỜ ở Đóng hàng như cũ', () => {
    const plan = resolve({
      stage: FulfillmentStage.SewOut,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Standard,
    });
    expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.Pack);
    expect(plan.patch.$set.fulfillmentCompletedAt).toBeUndefined();
  });

  it('redirectAutoTarget: target=Đóng hàng khi toggle ON lùi về công đoạn thường gần nhất', () => {
    expect(redirectAutoTarget(FactoryFlowType.Standard, FulfillmentStage.Pack, true)).toBe(FulfillmentStage.SewOut);
    // no-sew: pack auto → sew-out auto → sew-in auto → dừng ở QC sau ép.
    expect(redirectAutoTarget(FactoryFlowType.NoSew, FulfillmentStage.Pack, true)).toBe(FulfillmentStage.QCPostPress);
    // Toggle OFF: pack là stage thường, giữ nguyên.
    expect(redirectAutoTarget(FactoryFlowType.Standard, FulfillmentStage.Pack)).toBe(FulfillmentStage.Pack);
  });
});

describe('Complete trên xưởng press-complete (DTF Mê Linh) — Ép xong là xong', () => {
  it('In xong → dừng CHỜ ở Ép (nửa đầu vẫn tuần tự tay)', () => {
    const plan = resolve({
      stage: FulfillmentStage.Print,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.PressComplete,
    });
    expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.Press);
    expect(plan.patch.$set['fulfillmentStages.press.status']).toBe(FulfillmentStageStatus.Waiting);
    expect(timelineEntries(plan)).toHaveLength(1);
  });

  it('Ép xong → QC + May vào + May ra + Đóng hàng tự Done cùng lúc, flow KẾT THÚC (không cần toggle autoPack)', () => {
    const plan = resolve({
      stage: FulfillmentStage.Press,
      action: FulfillmentTransitionAction.Complete,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(new Date(Date.now() - 30_000)),
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.PressComplete,
      // autoPack cố ý KHÔNG bật — Pack nằm thẳng trong tập auto của flow.
    });

    const set = plan.patch.$set;
    for (const stg of ['qc-post-press', 'sew-in', 'sew-out', 'pack']) {
      expect(set[`fulfillmentStages.${stg}.status`]).toBe(FulfillmentStageStatus.Done);
      expect(set[`fulfillmentStages.${stg}.assignee`]).toBe('worker-1');
      expect(set[`fulfillmentStages.${stg}.workMs`]).toBe(0);
      for (const field of ['waitingAt', 'startedAt', 'firstStartedAt', 'completedAt']) {
        expect(set[`fulfillmentStages.${stg}.${field}`]).toBeInstanceOf(Date);
      }
    }
    expect(set.currentFulfillmentStage).toBeNull();
    expect(set.fulfillmentCompletedAt).toBeInstanceOf(Date);

    // Timeline 5 entry: press complete + 4 auto, đều ghi vết người Ép, nguồn
    // auto là LUỒNG RÚT GỌN (kể cả Pack — không phải toggle).
    const entries = timelineEntries(plan);
    expect(entries).toHaveLength(5);
    expect(entries[4].stage).toBe(FulfillmentStage.Pack);
    expect(entries[4].reason).toContain('luồng rút gọn');
  });

  it('redirectAutoTarget: lỗi nhắm QC/May/Đóng hàng đều lùi về Ép', () => {
    for (const target of [
      FulfillmentStage.QCPostPress,
      FulfillmentStage.SewIn,
      FulfillmentStage.SewOut,
      FulfillmentStage.Pack,
    ]) {
      expect(redirectAutoTarget(FactoryFlowType.PressComplete, target)).toBe(FulfillmentStage.Press);
    }
    expect(redirectAutoTarget(FactoryFlowType.PressComplete, FulfillmentStage.Press)).toBe(FulfillmentStage.Press);
    expect(redirectAutoTarget(FactoryFlowType.PressComplete, FulfillmentStage.Print)).toBe(FulfillmentStage.Print);
  });
});

describe('ReworkBack trên xưởng luồng rút gọn — redirect đích', () => {
  it('merged: QC báo lỗi target=Ép → lùi về In', () => {
    const plan = resolve({
      stage: FulfillmentStage.QCPostPress,
      action: FulfillmentTransitionAction.ReworkBack,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      target: FulfillmentStage.Press,
      reason: 'Lỗi ép',
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Merged,
    });
    const set = plan.patch.$set;
    expect(set.currentFulfillmentStage).toBe(FulfillmentStage.Print);
    expect(set['fulfillmentStages.print.status']).toBe(FulfillmentStageStatus.Rework);
    expect(set['fulfillmentStages.press.status']).toBeUndefined();
    expect(timelineEntries(plan)[0].reworkTarget).toBe(FulfillmentStage.Print);
  });

  it('merged: Đóng hàng báo lỗi target=May ra → lùi về May vào', () => {
    const plan = resolve({
      stage: FulfillmentStage.Pack,
      action: FulfillmentTransitionAction.ReworkBack,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      target: FulfillmentStage.SewOut,
      reason: 'Lỗi may',
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Merged,
    });
    expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.SewIn);
  });

  it('no-sew: Đóng hàng báo lỗi target=May vào/May ra → đều lùi về QC sau ép', () => {
    for (const target of [FulfillmentStage.SewIn, FulfillmentStage.SewOut]) {
      const plan = resolve({
        stage: FulfillmentStage.Pack,
        action: FulfillmentTransitionAction.ReworkBack,
        currentStatus: FulfillmentStageStatus.InProgress,
        stageState: inProgress(),
        target,
        reason: 'Lỗi hàng',
        stages: {} as FulfillmentStages,
        user: worker,
        flowType: FactoryFlowType.NoSew,
      });
      expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.QCPostPress);
      expect(plan.patch.$set['fulfillmentStages.qc-post-press.status']).toBe(FulfillmentStageStatus.Rework);
    }
  });

  it('xưởng thường: target=Ép giữ nguyên (không redirect)', () => {
    const plan = resolve({
      stage: FulfillmentStage.QCPostPress,
      action: FulfillmentTransitionAction.ReworkBack,
      currentStatus: FulfillmentStageStatus.InProgress,
      stageState: inProgress(),
      target: FulfillmentStage.Press,
      reason: 'Lỗi ép',
      stages: {} as FulfillmentStages,
      user: worker,
      flowType: FactoryFlowType.Standard,
    });
    expect(plan.patch.$set.currentFulfillmentStage).toBe(FulfillmentStage.Press);
  });
});
