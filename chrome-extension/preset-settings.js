/**
 * Settings applied once when the extension is installed with empty local
 * storage. Existing user settings always take precedence over this preset.
 */
globalThis.AMAZON_TRACKER_PRESET_SETTINGS = {
  amazonButtonColor: '#f59e0b',
  amazonButtonLabel: 'Get new orders',
  amazonPageCount: 2,
  amazonScheduleEnabled: true,
  amazonScheduleRuleCount: 4,
  amazonScheduleRules: [
    { days: [1, 2, 3, 4, 5, 6, 0], time: '09:00' },
    { days: [1, 2, 3, 4, 5, 6, 0], time: '15:00' },
    { days: [1, 2, 3, 4, 5, 6, 0], time: '21:00' },
    { days: [1, 2, 3, 4, 5, 6, 0], time: '03:00' },
    { days: [1, 2, 3, 4, 5, 6, 0], time: '21:00' },
    { days: [1, 2, 3, 4, 5, 6, 0], time: '23:00' }
  ],
  amazonWebhook: 'https://script.google.com/macros/s/AKfycbxcVCOI9Ay8-PfqHMCkJjO2mxbCugVeV3v6CEYjEqb7b1tojt2oCsI6Uuu6H4a7NGNb/exec?action=amazon_orders',
  autoLaunchEnabled: true,
  autoLaunchInterval: 60,
  closeTabs: true,
  customWorkflows: [
    {
      buttonColor: '#7c3aed',
      destinationWebhook: 'https://script.google.com/macros/s/AKfycbxcVCOI9Ay8-PfqHMCkJjO2mxbCugVeV3v6CEYjEqb7b1tojt2oCsI6Uuu6H4a7NGNb/exec?action=update_tracking',
      enabled: true,
      id: 'custom-1',
      maxLinks: 600,
      name: 'Get Shipped updates',
      scheduleEnabled: true,
      scheduleRuleCount: 2,
      scheduleRules: [
        { days: [6, 0], time: '09:00' },
        { days: [6, 0], time: '21:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '15:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '18:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '21:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '23:00' }
      ],
      sourceWebhook: 'https://script.google.com/macros/s/AKfycbxcVCOI9Ay8-PfqHMCkJjO2mxbCugVeV3v6CEYjEqb7b1tojt2oCsI6Uuu6H4a7NGNb/exec?action=get_shipped'
    },
    {
      buttonColor: '#059669',
      destinationWebhook: '',
      enabled: false,
      id: 'custom-2',
      maxLinks: 0,
      name: 'Workflow 2',
      scheduleEnabled: false,
      scheduleRuleCount: 1,
      scheduleRules: [
        { days: [1, 2, 3, 4, 5, 6, 0], time: '12:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '12:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '15:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '18:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '21:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '23:00' }
      ],
      sourceWebhook: ''
    },
    {
      buttonColor: '#db2777',
      destinationWebhook: '',
      enabled: false,
      id: 'custom-3',
      maxLinks: 0,
      name: 'Workflow 3',
      scheduleEnabled: false,
      scheduleRuleCount: 1,
      scheduleRules: [
        { days: [1, 2, 3, 4, 5, 6, 0], time: '15:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '12:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '15:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '18:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '21:00' },
        { days: [1, 2, 3, 4, 5, 6, 0], time: '23:00' }
      ],
      sourceWebhook: ''
    }
  ],
  enableFetch: true,
  fetchUrl: 'https://script.google.com/macros/s/AKfycbxcVCOI9Ay8-PfqHMCkJjO2mxbCugVeV3v6CEYjEqb7b1tojt2oCsI6Uuu6H4a7NGNb/exec?action=get_ordered',
  generalButtonColor: '#2563eb',
  generalButtonLabel: 'Get Ordered updates',
  generalMaxLinks: 100,
  idleEnabled: true,
  idleMinutes: 10,
  liveWebhook: 'https://script.google.com/macros/s/AKfycbxcVCOI9Ay8-PfqHMCkJjO2mxbCugVeV3v6CEYjEqb7b1tojt2oCsI6Uuu6H4a7NGNb/exec?action=update_tracking',
  maxOpenTime: 20,
  minOpenTime: 10,
  scheduleDays: [1, 2, 3, 4, 5, 6, 0],
  scheduleEnabled: false,
  scheduleStart: '09:00',
  scheduleStop: '17:00'
};
