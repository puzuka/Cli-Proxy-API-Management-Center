import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { AuthFileModelItem } from '@/features/authFiles/constants';

type ModelsError = 'unsupported' | null;
export type ModelTestStatus = 'idle' | 'loading' | 'success' | 'error';
export type ModelTestState = {
  status: ModelTestStatus;
  message?: string;
  responseTimeMs?: number;
};

export type UseAuthFilesModelsResult = {
  modelsModalOpen: boolean;
  modelsLoading: boolean;
  modelsList: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  modelsManual: boolean;
  modelsSaving: boolean;
  modelsError: ModelsError;
  modelTestStatuses: Record<string, ModelTestState>;
  showModels: (item: AuthFileItem) => Promise<void>;
  saveModels: (models: AuthFileModelItem[]) => Promise<void>;
  testModel: (modelId: string) => Promise<void>;
  closeModelsModal: () => void;
};

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export function useAuthFilesModels(): UseAuthFilesModelsResult {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsAuthIndex, setModelsAuthIndex] = useState('');
  const [modelsManual, setModelsManual] = useState(false);
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsError, setModelsError] = useState<ModelsError>(null);
  const [modelTestStatuses, setModelTestStatuses] = useState<Record<string, ModelTestState>>({});
  const modelsCacheRef = useRef<Map<string, { models: AuthFileModelItem[]; manual: boolean }>>(
    new Map()
  );
  const modelsContextKeyRef = useRef('');

  const closeModelsModal = useCallback(() => {
    setModelsModalOpen(false);
  }, []);

  const showModels = useCallback(
    async (item: AuthFileItem) => {
      const authIndex = normalizeAuthIndex(item['auth_index'] ?? item.authIndex) ?? '';
      modelsContextKeyRef.current = `${item.name}\n${authIndex}`;
      setModelsFileName(item.name);
      setModelsFileType(item.type || '');
      setModelsAuthIndex(authIndex);
      setModelsList([]);
      setModelsManual(false);
      setModelsError(null);
      setModelTestStatuses({});
      setModelsModalOpen(true);

      const cached = modelsCacheRef.current.get(item.name);
      if (cached) {
        setModelsList(cached.models);
        setModelsManual(cached.manual);
        setModelsLoading(false);
        return;
      }

      setModelsLoading(true);
      try {
        const result = await authFilesApi.getModelsForAuthFile(item.name);
        modelsCacheRef.current.set(item.name, result);
        setModelsList(result.models);
        setModelsManual(result.manual);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '';
        if (
          errorMessage.includes('404') ||
          errorMessage.includes('not found') ||
          errorMessage.includes('Not Found')
        ) {
          setModelsError('unsupported');
        } else {
          showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
        }
      } finally {
        setModelsLoading(false);
      }
    },
    [showNotification, t]
  );

  const saveModels = useCallback(
    async (models: AuthFileModelItem[]) => {
      const name = modelsFileName.trim();
      if (!name) return;

      setModelsSaving(true);
      try {
        const result = await authFilesApi.saveModelsForAuthFile(name, models);
        modelsCacheRef.current.set(name, result);
        setModelsList(result.models);
        setModelsManual(result.manual);
        setModelTestStatuses({});
        showNotification(
          t('auth_files.models_save_success', { defaultValue: 'Model list saved' }),
          'success'
        );
      } catch (err) {
        const errorMessage =
          getErrorMessage(err) || t('common.unknown_error', { defaultValue: 'Unknown error' });
        showNotification(
          `${t('notification.save_failed', { defaultValue: 'Save failed' })}: ${errorMessage}`,
          'error'
        );
        throw err;
      } finally {
        setModelsSaving(false);
      }
    },
    [modelsFileName, showNotification, t]
  );

  const testModel = useCallback(
    async (modelId: string) => {
      const model = String(modelId ?? '').trim();
      const name = modelsFileName.trim();
      if (!model || !name) return;

      const contextKey = modelsContextKeyRef.current;
      const updateStatus = (state: ModelTestState) => {
        if (modelsContextKeyRef.current !== contextKey) return;
        setModelTestStatuses((current) => ({
          ...current,
          [model]: state,
        }));
      };

      updateStatus({
        status: 'loading',
        message: t('auth_files.model_test_running', { defaultValue: 'Testing...' }),
      });

      try {
        const result = await authFilesApi.testModelForAuthFile({
          name,
          authIndex: modelsAuthIndex || undefined,
          model,
        });
        const responseTimeMs =
          typeof result.response_time_ms === 'number' && Number.isFinite(result.response_time_ms)
            ? result.response_time_ms
            : undefined;
        updateStatus({
          status: 'success',
          responseTimeMs,
          message:
            responseTimeMs === undefined
              ? t('auth_files.model_test_success', { defaultValue: 'Test passed' })
              : t('auth_files.model_test_success_ms', {
                  defaultValue: 'OK ({{ms}} ms)',
                  ms: responseTimeMs,
                }),
        });
      } catch (err) {
        const errorMessage =
          getErrorMessage(err) || t('common.unknown_error', { defaultValue: 'Unknown error' });
        updateStatus({
          status: 'error',
          message: `${t('auth_files.model_test_failed', { defaultValue: 'Test failed' })}: ${errorMessage}`,
        });
      }
    },
    [modelsAuthIndex, modelsFileName, t]
  );

  return {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsManual,
    modelsSaving,
    modelsError,
    modelTestStatuses,
    showModels,
    saveModels,
    testModel,
    closeModelsModal,
  };
}
