import './styles.css';
import { mountApp } from '@zero1/web-core';
import { crmAppMeta, crmModules } from './modules';

mountApp(crmAppMeta, crmModules);
