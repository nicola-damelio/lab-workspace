/* =========================================================================
   src/components/AppModules/storageModuleViews.jsx
   Storage & Boxes module views (StorageFinder + StorageList + StorageDetail),
   extracted from App.jsx. Props-only.
   ========================================================================= */

import React from 'react';
import { StorageFinder } from './storageModules';
import { StorageList, StorageDetail } from '../Storage';

export const StorageModule = ({
  currentModule, tests, setTests, storages, setStorages, operatorNames,
  setActiveTestId, setCurrentModule, setActiveStorageId, setStorageModal,
  handlePrint, activeStorageId, jumpToTest, setMoveModal, createEmptyTest
}) => (
  <>
    {currentModule === 'storage' && (
  <div className="h-full min-h-0 flex flex-col overflow-y-auto md:overflow-hidden bg-slate-50 custom-scrollbar">
    <StorageFinder
      tests={tests}
      storages={storages}
      operators={operatorNames}
      onOpenTest={(testId) => {
        setActiveTestId(testId);
        setCurrentModule('active-test');
      }}
      onOpenStorage={(storageId) => {
        if (!storageId) return;
        setActiveStorageId(storageId);
        setCurrentModule('storage-detail');
      }}
    />

    <div className="md:flex-1 md:min-h-0 md:overflow-y-auto custom-scrollbar">
      <StorageList
        storages={storages}
        tests={tests}
        setStorageModal={setStorageModal}
        setActiveStorageId={setActiveStorageId}
        setCurrentModule={setCurrentModule}
        handlePrint={handlePrint}
        operators={operatorNames}
      />
    </div>
  </div>
    )}
    {currentModule === 'storage-detail' && (
              <StorageDetail
                storages={storages}
                setStorages={setStorages}
                activeStorageId={activeStorageId}
                tests={tests}
                setTests={setTests}
                setCurrentModule={setCurrentModule}
                handlePrint={handlePrint}
                jumpToTest={jumpToTest}
                setMoveModal={setMoveModal}
                createEmptyTest={createEmptyTest}
                setActiveTestId={setActiveTestId}
                operators={operatorNames}
              />
    )}
  </>
);
