import './styles.css';
import { mountApp } from '@zero1/web-core';
import { lmsAppMeta, lmsModules } from './modules';

mountApp(lmsAppMeta, lmsModules);
